import { MEMORY_OPERATIONS, isOpaqueId, type MemoryOperation } from "./memory-contract";

/*
  Predicates: the typed conditions and exceptions of a decision or a commitment.

  A decision's narrative keeps saying «only in production» in the owner's words; this module is
  the part of that sentence a program can answer without a model. An expression is a small tree
  of `all`, `any` and `not` over six closed leaves, and the answer is three-valued: `true`,
  `false` or `unknown`. The third value is the whole point. A fact the caller did not declare —
  no operation, no path, a check nobody has observed yet — does not silently become `false`, which
  would let a condition fail and an exception pass by the mere absence of information; it stays
  `unknown` and travels as a check that is still required (plan §20.3). `all` decides `false` on
  one false child and `true` only when every child is true; `any` is its dual; `not` keeps
  `unknown` as it is.

  The validator is the border between what the server stored and what the evaluator trusts:
  every node is a closed object (an extra key is a shape error, never ignored), arrays are never
  empty, the tree is at most four levels deep with at most twenty leaves, and every leaf value
  has the shape its kind demands. A repeated object reference — the same JavaScript object reached
  through two parents — is the one thing JSON cannot express and a caller could still build, so it
  is rejected structurally as well. Nothing here touches the disk, the catalog or the clock:
  `checks-eval.ts` produces the observations, the selector turns them into facts, and this module
  only says what follows from them.
 */

/** The bounds of an expression; a tree beyond them is refused, never trimmed. */
export const PREDICATE_LIMITS = { depth: 4, leaves: 20, children: 20 } as const;

export const PREDICATE_LEAF_KINDS = [
  "project_is",
  "path_under",
  "operation_is",
  "environment_is",
  "task_kind_is",
  "check_result_is",
] as const;
export type PredicateLeafKind = (typeof PREDICATE_LEAF_KINDS)[number];

/** Three-valued truth: `unknown` is an answer, not an error. */
export type Tri = "true" | "false" | "unknown";

export type CheckResult = "pass" | "fail" | "unknown";
export const CHECK_RESULTS: readonly CheckResult[] = ["pass", "fail", "unknown"];

export type PredicateLeaf =
  | { kind: "project_is"; projectId: string }
  | { kind: "path_under"; path: string }
  | { kind: "operation_is"; operation: MemoryOperation }
  | { kind: "environment_is"; environmentId: string }
  | { kind: "task_kind_is"; taskKind: string }
  | { kind: "check_result_is"; checkId: string; revision: number; result: CheckResult };

export type PredicateNode =
  | { all: PredicateNode[] }
  | { any: PredicateNode[] }
  | { not: PredicateNode }
  | PredicateLeaf;

export interface Predicate {
  schemaVersion: 1;
  expression: PredicateNode;
}

/** A check observation as the evaluator sees it: what it said and whether that is still fresh. */
export interface CheckFact {
  result: CheckResult;
  fresh: boolean;
}

/**
 * What the caller knows when it evaluates. Every member is optional because every one of them
 * may legitimately be unknown: a brief has no operation, an orientation no path, a project whose
 * identity did not resolve no id. `checks` is keyed by `${checkId}:${revision}`.
 */
export interface PredicateFacts {
  projectId?: string;
  path?: string;
  operation?: string;
  environmentId?: string;
  taskKind?: string;
  checks?: Record<string, CheckFact>;
}

export interface CheckRef {
  checkId: string;
  revision: number;
}

/**
 * A shape error with a stable code the routes can hand back as the reason of a `400`. The
 * message is for a person; the code is for a program.
 */
export class MemoryShapeError extends TypeError {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "MemoryShapeError";
  }
}

const CHECK_ID = /^chk_[A-Za-z0-9_-]{8,64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const TASK_KIND = /^[a-z][a-z0-9_-]{0,63}$/;
const PATH_MAX = 2_048;

/** The key of a check inside `PredicateFacts.checks`. */
export function checkFactKey(ref: CheckRef): string {
  return `${ref.checkId}:${ref.revision}`;
}

/**
 * A bounded literal path inside a project: relative, forward slashes, no `.` or `..` segments,
 * no wildcard, no control character. The same rule as `validMemoryPath` in `@panoma/db`, written
 * here because core does not import the catalog.
 */
export function validRelativePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > PATH_MAX) return false;
  if (path !== path.trim() || /^[A-Za-z]:/.test(path) || path.startsWith("/")) return false;
  if (path.includes("\\") || path.includes("*") || /\p{Cc}/u.test(path)) return false;
  return path.split("/").every((segment) => segment.trim() !== "" && segment !== "." && segment !== "..");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(node: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) throw new MemoryShapeError("extra_key", `Unknown key "${key}" in a ${where}.`);
  }
  for (const key of allowed) {
    if (!(key in node)) throw new MemoryShapeError("missing_key", `A ${where} needs "${key}".`);
  }
}

function validateLeaf(node: Record<string, unknown>): PredicateLeaf {
  const kind = node["kind"];
  if (typeof kind !== "string" || !(PREDICATE_LEAF_KINDS as readonly string[]).includes(kind)) {
    throw new MemoryShapeError("unknown_kind", "A predicate leaf names one of the six closed kinds.");
  }
  switch (kind as PredicateLeafKind) {
    case "project_is": {
      assertKeys(node, ["kind", "projectId"], "project_is leaf");
      const projectId = node["projectId"];
      if (!isOpaqueId(projectId)) throw new MemoryShapeError("leaf_value", "project_is needs an opaque project id.");
      return { kind: "project_is", projectId };
    }
    case "path_under": {
      assertKeys(node, ["kind", "path"], "path_under leaf");
      const path = node["path"];
      if (!validRelativePath(path)) throw new MemoryShapeError("leaf_value", "path_under needs a relative path inside the project.");
      return { kind: "path_under", path };
    }
    case "operation_is": {
      assertKeys(node, ["kind", "operation"], "operation_is leaf");
      const operation = node["operation"];
      if (typeof operation !== "string" || !(MEMORY_OPERATIONS as readonly string[]).includes(operation)) {
        throw new MemoryShapeError("leaf_value", "operation_is needs a memory operation.");
      }
      return { kind: "operation_is", operation: operation as MemoryOperation };
    }
    case "environment_is": {
      assertKeys(node, ["kind", "environmentId"], "environment_is leaf");
      const environmentId = node["environmentId"];
      if (typeof environmentId !== "string" || !SHA256_HEX.test(environmentId)) {
        throw new MemoryShapeError("leaf_value", "environment_is needs an observed environment id.");
      }
      return { kind: "environment_is", environmentId };
    }
    case "task_kind_is": {
      assertKeys(node, ["kind", "taskKind"], "task_kind_is leaf");
      const taskKind = node["taskKind"];
      if (typeof taskKind !== "string" || !TASK_KIND.test(taskKind)) {
        throw new MemoryShapeError("leaf_value", "task_kind_is needs an explicit task label.");
      }
      return { kind: "task_kind_is", taskKind };
    }
    case "check_result_is": {
      assertKeys(node, ["kind", "checkId", "revision", "result"], "check_result_is leaf");
      const checkId = node["checkId"];
      const revision = node["revision"];
      const result = node["result"];
      if (typeof checkId !== "string" || !CHECK_ID.test(checkId)) throw new MemoryShapeError("leaf_value", "check_result_is needs a check id.");
      if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
        throw new MemoryShapeError("leaf_value", "check_result_is needs a check revision of at least 1.");
      }
      if (typeof result !== "string" || !(CHECK_RESULTS as readonly string[]).includes(result)) {
        throw new MemoryShapeError("leaf_value", "check_result_is needs pass, fail or unknown.");
      }
      return { kind: "check_result_is", checkId, revision, result: result as CheckResult };
    }
  }
}

interface Walk {
  leaves: number;
  seen: Set<object>;
}

function validateNode(value: unknown, depth: number, walk: Walk): PredicateNode {
  if (!isPlainObject(value)) throw new MemoryShapeError("not_object", "A predicate node is an object.");
  if (walk.seen.has(value)) throw new MemoryShapeError("repeated_node", "A predicate node appears twice in the tree.");
  walk.seen.add(value);
  if (depth > PREDICATE_LIMITS.depth) {
    throw new MemoryShapeError("depth", `A predicate is at most ${PREDICATE_LIMITS.depth} levels deep.`);
  }

  if ("all" in value || "any" in value) {
    const operator = "all" in value ? "all" : "any";
    assertKeys(value, [operator], `${operator} node`);
    const children = value[operator];
    if (!Array.isArray(children)) throw new MemoryShapeError("not_array", `"${operator}" takes a list of nodes.`);
    if (children.length === 0) throw new MemoryShapeError("empty_array", `"${operator}" takes at least one node.`);
    if (children.length > PREDICATE_LIMITS.children) {
      throw new MemoryShapeError("children", `"${operator}" takes at most ${PREDICATE_LIMITS.children} nodes.`);
    }
    const validated = children.map((child) => validateNode(child, depth + 1, walk));
    return operator === "all" ? { all: validated } : { any: validated };
  }

  if ("not" in value) {
    assertKeys(value, ["not"], "not node");
    return { not: validateNode(value["not"], depth + 1, walk) };
  }

  walk.leaves += 1;
  if (walk.leaves > PREDICATE_LIMITS.leaves) {
    throw new MemoryShapeError("leaves", `A predicate has at most ${PREDICATE_LIMITS.leaves} leaves.`);
  }
  return validateLeaf(value);
}

/**
 * The stored shape, checked whole. Returns a fresh tree that carries only validated keys, so a
 * caller can persist the result and never the input. Depth counts nodes on the longest path from
 * the expression to a leaf, the leaf included: a bare leaf is depth 1, `{ all: [leaf] }` is 2.
 */
export function validatePredicate(input: unknown): Predicate {
  if (!isPlainObject(input)) throw new MemoryShapeError("not_object", "A predicate is an object.");
  assertKeys(input, ["schemaVersion", "expression"], "predicate");
  if (input["schemaVersion"] !== 1) throw new MemoryShapeError("schema_version", "A predicate has schemaVersion 1.");
  const expression = validateNode(input["expression"], 1, { leaves: 0, seen: new Set() });
  return { schemaVersion: 1, expression };
}

/** The same validation for a bare expression, for callers that hold the node and not the envelope. */
export function validateExpression(input: unknown): PredicateNode {
  return validateNode(input, 1, { leaves: 0, seen: new Set() });
}

function not(value: Tri): Tri {
  if (value === "true") return "false";
  if (value === "false") return "true";
  return "unknown";
}

function pathUnder(path: string, segment: string): boolean {
  return path === segment || path.startsWith(`${segment}/`);
}

function evaluateLeaf(leaf: PredicateLeaf, facts: PredicateFacts): Tri {
  switch (leaf.kind) {
    case "project_is":
      if (facts.projectId === undefined) return "unknown";
      return facts.projectId === leaf.projectId ? "true" : "false";
    case "path_under":
      if (facts.path === undefined) return "unknown";
      return pathUnder(facts.path, leaf.path) ? "true" : "false";
    case "operation_is":
      if (facts.operation === undefined) return "unknown";
      return facts.operation === leaf.operation ? "true" : "false";
    case "environment_is":
      if (facts.environmentId === undefined) return "unknown";
      return facts.environmentId === leaf.environmentId ? "true" : "false";
    case "task_kind_is":
      if (facts.taskKind === undefined) return "unknown";
      return facts.taskKind === leaf.taskKind ? "true" : "false";
    case "check_result_is": {
      const observed = facts.checks?.[checkFactKey(leaf)];
      /*
        A stale observation is no observation: the rule asks for the last fresh look at that
        revision, and an old pass must not keep a condition true after the disk moved. And an
        observation that said `unknown` decided nothing about pass or fail — it only matches a
        leaf that asks for `unknown` itself.
       */
      if (observed === undefined || !observed.fresh) return "unknown";
      if (observed.result === "unknown") return leaf.result === "unknown" ? "true" : "unknown";
      return observed.result === leaf.result ? "true" : "false";
    }
  }
}

/**
 * Three-valued evaluation. The expression is trusted to have passed `validatePredicate`; the
 * facts are whatever the caller can honestly declare, and whatever it cannot is `unknown`.
 */
export function evaluatePredicate(expression: PredicateNode, facts: PredicateFacts): Tri {
  if ("all" in expression) {
    let unknown = false;
    for (const child of expression.all) {
      const value = evaluatePredicate(child, facts);
      if (value === "false") return "false";
      if (value === "unknown") unknown = true;
    }
    return unknown ? "unknown" : "true";
  }
  if ("any" in expression) {
    let unknown = false;
    for (const child of expression.any) {
      const value = evaluatePredicate(child, facts);
      if (value === "true") return "true";
      if (value === "unknown") unknown = true;
    }
    return unknown ? "unknown" : "false";
  }
  if ("not" in expression) return not(evaluatePredicate(expression.not, facts));
  return evaluateLeaf(expression, facts);
}

/** Every check an expression consults, in tree order, each (id, revision) once. */
export function predicateChecks(expression: PredicateNode): CheckRef[] {
  const refs: CheckRef[] = [];
  const seen = new Set<string>();
  const visit = (node: PredicateNode): void => {
    if ("all" in node) node.all.forEach(visit);
    else if ("any" in node) node.any.forEach(visit);
    else if ("not" in node) visit(node.not);
    else if (node.kind === "check_result_is") {
      const key = checkFactKey(node);
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ checkId: node.checkId, revision: node.revision });
      }
    }
  };
  visit(expression);
  return refs;
}

/**
 * The checks that decided nothing: `check_result_is` leaves that evaluated to `unknown` inside
 * the part of the tree whose value is still `unknown`. A leaf under an `any` that another child
 * already made true is not collected — it decided nothing, but nothing was left to decide.
 */
function undecidedChecks(expression: PredicateNode, facts: PredicateFacts, into: Map<string, CheckRef>): void {
  if (evaluatePredicate(expression, facts) !== "unknown") return;
  if ("all" in expression) expression.all.forEach((child) => undecidedChecks(child, facts, into));
  else if ("any" in expression) expression.any.forEach((child) => undecidedChecks(child, facts, into));
  else if ("not" in expression) undecidedChecks(expression.not, facts, into);
  else if (expression.kind === "check_result_is") {
    into.set(checkFactKey(expression), { checkId: expression.checkId, revision: expression.revision });
  }
}

export interface Applicability {
  applicable: Tri;
  /** The check observations that would settle an `unknown`; empty when the answer is settled. */
  requiresCheck: CheckRef[];
}

/**
 * Whether an item applies here: its conditions must hold and none of its exceptions may. A
 * missing predicate is the identity of its side — no conditions means they hold, no exceptions
 * means none applies. A false condition or a true exception settles `false`; anything short of
 * true conditions and false exceptions is `unknown`, and `requiresCheck` names the checks that
 * would have decided it (plan §20.3: an unknown exception requires checking, it never applies
 * by default and never withholds by default).
 */
export function applicability(
  conditions: PredicateNode | null | undefined,
  exceptions: PredicateNode | null | undefined,
  facts: PredicateFacts,
): Applicability {
  const held = conditions ? evaluatePredicate(conditions, facts) : "true";
  const excepted = exceptions ? evaluatePredicate(exceptions, facts) : "false";
  if (held === "false" || excepted === "true") return { applicable: "false", requiresCheck: [] };
  if (held === "true" && excepted === "false") return { applicable: "true", requiresCheck: [] };

  const pending = new Map<string, CheckRef>();
  if (conditions && held === "unknown") undecidedChecks(conditions, facts, pending);
  if (exceptions && excepted === "unknown") undecidedChecks(exceptions, facts, pending);
  return { applicable: "unknown", requiresCheck: [...pending.values()] };
}
