import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { canonicalJson, sha256Hex } from "./memory-contract";
import { MemoryShapeError, validRelativePath, type CheckResult } from "./predicates";

/*
  The check evaluator: what a note, a decision, a criterion or a commitment can ask the disk,
  and what the disk may answer.

  A check never verifies a whole sentence (plan §9.1). It verifies one literal thing — a path
  exists, a file has this hash, this text is in it or not, this manifest defines this script,
  this manifest declares this dependency, this key in this JSON/TOML/YAML has this value — and
  it answers `pass`, `fail` or `unknown` with a reason and the exact files it looked at. The
  third answer is the one the rest of the memory is built on: a file that cannot be read, a
  symlink that leaves the project, a file over the byte cap, a document that does not parse or
  that is deeper or wider than the walker accepts are `unknown` with the reason, never `fail` —
  a `fail` challenges a note or opens an incident, and none of those situations is evidence
  against anything (C02/T46).

  What the evaluator refuses to be: a runner. No script is executed, no test is launched, no
  regular expression or module name from a user, a model or a transcript is interpreted; the
  parsers are the closed ones this package already uses for manifests (`JSON.parse`, `smol-toml`,
  `yaml` with their defaults), applied after the byte cap. `manifest_script` says a script exists
  with a definition; observing a test that ran is a different kind of evidence.

  Absence has one owner. `path_exists` answers existence; the content kinds answer `unknown`
  with reason `missing` when the file is not there, because «the text is absent from a file that
  does not exist» would let a `text_absent` violation check pass on a deleted file and a
  `file_hash` grounds check fail on a moved one. A rule whose file may disappear carries a
  `path_exists` check for that on its own.

  The environment (plan §9.2) is what makes an observation local: the resolved root, the HEAD
  read from `.git/HEAD` and its ref file without running git, and a fingerprint of the files
  actually inspected with their hashes. Two dirty worktrees at the same HEAD are two
  environments (C03/T48); a verification never transfers between them.
 */

export const CHECK_PURPOSES = ["grounds", "applicability", "violation", "completion"] as const;
export type CheckPurpose = (typeof CHECK_PURPOSES)[number];

export const CHECK_KINDS = [
  "path_exists",
  "file_hash",
  "text_present",
  "text_absent",
  "manifest_script",
  "direct_dependency",
  "structured_key",
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export const DEPENDENCY_ECOSYSTEMS = ["npm", "pnpm", "cargo", "pip", "go"] as const;
export type DependencyEcosystem = (typeof DEPENDENCY_ECOSYSTEMS)[number];

/** The bounds of one evaluation; a caller may lower them, never raise them past a MiB in practice. */
export const CHECK_LIMITS = {
  /** Bytes a content check reads at most; over it the file is `too_large` and the answer `unknown`. */
  fileBytes: 1_048_576,
  /** Levels a structured walk descends at most. */
  documentDepth: 32,
  /** Entries a container may hold at a level the walk visits. */
  documentKeys: 32,
  /** UTF-16 units of a target path. */
  targetLength: 2_048,
} as const;
export type CheckLimits = { -readonly [K in keyof typeof CHECK_LIMITS]: number };

/** UTF-16 units of an expected literal, a script definition or a canonical expected value. */
export const CHECK_LITERAL_MAX = 2_048;
/** Segments of a structured key path. */
export const KEY_PATH_MAX = 20;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ManifestScriptExpected {
  name: string;
  definition?: string;
}

export interface DirectDependencyExpected {
  ecosystem: DependencyEcosystem;
  name: string;
  version?: string;
}

export interface StructuredKeyExpected {
  path: string[];
  value?: JsonValue;
}

interface CheckEnvelope {
  schemaVersion: 1;
  /**
   * Assigned by the catalog when the check is stored; absent on a legacy anchor and on a
   * definition that has not been put yet. `revision` starts at 1 and rises only when the
   * definition changes; observing never moves it.
   */
  checkId?: string;
  revision?: number;
  purpose: CheckPurpose;
}

export type CheckDefinition =
  | { kind: "path_exists"; target: string; expected: boolean }
  | { kind: "file_hash"; target: string; expected: string }
  | { kind: "text_present"; target: string; expected: string }
  | { kind: "text_absent"; target: string; expected: string }
  | { kind: "manifest_script"; target: string; expected: ManifestScriptExpected }
  | { kind: "direct_dependency"; target: string; expected: DirectDependencyExpected }
  | { kind: "structured_key"; target: string; expected: StructuredKeyExpected };

export type Check = CheckEnvelope & CheckDefinition;
export type StoredCheck = Check & { checkId: string; revision: number };

export function isStoredCheck(check: Check): check is StoredCheck {
  return typeof check.checkId === "string" && typeof check.revision === "number";
}

const LEGACY_KINDS = ["path_exists", "file_hash", "file_contains"] as const;
const CHECK_ID = /^chk_[A-Za-z0-9_-]{8,64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** A legacy `file_hash` anchor stored the first sixteen hex characters of the digest. */
const SHA256_PREFIX = /^[0-9a-f]{16,64}$/;
const DEPENDENCY_NAME_MAX = 214;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function literal(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > CHECK_LITERAL_MAX) {
    throw new MemoryShapeError("expected", `${what} is a literal of 1 to ${CHECK_LITERAL_MAX} characters.`);
  }
  return value;
}

function name(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > DEPENDENCY_NAME_MAX || value !== value.trim() || /\p{Cc}|\s/u.test(value)) {
    throw new MemoryShapeError("expected", `${what} is a name without spaces or control characters.`);
  }
  return value;
}

function assertOnly(record: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new MemoryShapeError("extra_key", `Unknown key "${key}" in ${where}.`);
  }
}

/** A JSON value whose canonical form fits the literal cap; anything else is not an expected value. */
function jsonValue(value: unknown): JsonValue {
  let canonical: string;
  try {
    canonical = canonicalJson(value);
  } catch {
    throw new MemoryShapeError("expected", "An expected value is JSON.");
  }
  if (canonical.length > CHECK_LITERAL_MAX) {
    throw new MemoryShapeError("expected", `An expected value fits ${CHECK_LITERAL_MAX} characters of canonical JSON.`);
  }
  return JSON.parse(canonical) as JsonValue;
}

function validateTarget(value: unknown, limits: CheckLimits = { ...CHECK_LIMITS }): string {
  if (!validRelativePath(value) || value.length > limits.targetLength) {
    throw new MemoryShapeError("target", "A check target is a relative path inside the project.");
  }
  return value;
}

/** The file a dependency manifest of that ecosystem is, by its base name. */
function manifestFits(ecosystem: DependencyEcosystem, target: string): boolean {
  const base = basename(target);
  switch (ecosystem) {
    case "npm":
    case "pnpm":
      return base === "package.json";
    case "cargo":
      return base === "Cargo.toml";
    case "pip":
      return base === "pyproject.toml" || (base.startsWith("requirements") && base.endsWith(".txt"));
    case "go":
      return base === "go.mod";
  }
}

type DocumentFormat = "json" | "toml" | "yaml";

function documentFormat(target: string): DocumentFormat | undefined {
  switch (extname(target).toLowerCase()) {
    case ".json":
      return "json";
    case ".toml":
      return "toml";
    case ".yaml":
    case ".yml":
      return "yaml";
    default:
      return undefined;
  }
}

function validateDefinition(kind: CheckKind, target: string, expected: unknown): CheckDefinition {
  switch (kind) {
    case "path_exists":
      if (typeof expected !== "boolean") throw new MemoryShapeError("expected", "path_exists expects true or false.");
      return { kind, target, expected };
    case "file_hash":
      if (typeof expected !== "string" || !SHA256_HEX.test(expected)) {
        throw new MemoryShapeError("expected", "file_hash expects a sha256 in lowercase hex.");
      }
      return { kind, target, expected };
    case "text_present":
    case "text_absent":
      return { kind, target, expected: literal(expected, `${kind}`) };
    case "manifest_script": {
      if (!isPlainObject(expected)) throw new MemoryShapeError("expected", "manifest_script expects { name, definition? }.");
      assertOnly(expected, ["name", "definition"], "manifest_script expected");
      if (documentFormat(target) !== "json") throw new MemoryShapeError("target", "manifest_script reads a JSON manifest.");
      const script: ManifestScriptExpected = { name: name(expected["name"], "A script name") };
      if (expected["definition"] !== undefined) script.definition = literal(expected["definition"], "A script definition");
      return { kind, target, expected: script };
    }
    case "direct_dependency": {
      if (!isPlainObject(expected)) throw new MemoryShapeError("expected", "direct_dependency expects { ecosystem, name, version? }.");
      assertOnly(expected, ["ecosystem", "name", "version"], "direct_dependency expected");
      const ecosystem = expected["ecosystem"];
      if (typeof ecosystem !== "string" || !(DEPENDENCY_ECOSYSTEMS as readonly string[]).includes(ecosystem)) {
        throw new MemoryShapeError("expected", "direct_dependency names one of npm, pnpm, cargo, pip or go.");
      }
      if (!manifestFits(ecosystem as DependencyEcosystem, target)) {
        throw new MemoryShapeError("target", `A ${ecosystem} dependency is read from that ecosystem's manifest.`);
      }
      const dependency: DirectDependencyExpected = { ecosystem: ecosystem as DependencyEcosystem, name: name(expected["name"], "A dependency name") };
      if (expected["version"] !== undefined) dependency.version = literal(expected["version"], "A dependency version");
      return { kind, target, expected: dependency };
    }
    case "structured_key": {
      if (!isPlainObject(expected)) throw new MemoryShapeError("expected", "structured_key expects { path, value? }.");
      assertOnly(expected, ["path", "value"], "structured_key expected");
      if (documentFormat(target) === undefined) throw new MemoryShapeError("target", "structured_key reads a .json, .toml, .yaml or .yml file.");
      const path = expected["path"];
      if (!Array.isArray(path) || path.length === 0 || path.length > KEY_PATH_MAX) {
        throw new MemoryShapeError("expected", `A key path has 1 to ${KEY_PATH_MAX} segments.`);
      }
      const segments = path.map((segment) => {
        if (typeof segment !== "string" || segment.length === 0 || segment.length > CHECK_LITERAL_MAX) {
          throw new MemoryShapeError("expected", "A key path segment is a non-empty string.");
        }
        return segment;
      });
      const key: StructuredKeyExpected = { path: segments };
      if (expected["value"] !== undefined) key.value = jsonValue(expected["value"]);
      return { kind, target, expected: key };
    }
  }
}

function normalizeLegacy(input: Record<string, unknown>): Check {
  assertOnly(input, ["kind", "target", "expected"], "a legacy sentinel");
  const kind = input["kind"] as (typeof LEGACY_KINDS)[number];
  const target = validateTarget(input["target"]);
  const expected = input["expected"];
  /*
    A legacy anchor is the note's own foundation — the paths its body named the day it was
    approved — so it reads as a `grounds` check. Its hash is the sixteen-character prefix the old
    sentinel stored; the evaluator compares by prefix when the expectation is shorter than a
    whole digest.
   */
  switch (kind) {
    case "path_exists":
      if (typeof expected !== "boolean") throw new MemoryShapeError("expected", "path_exists expects true or false.");
      return { schemaVersion: 1, purpose: "grounds", kind, target, expected };
    case "file_hash":
      if (typeof expected !== "string" || !SHA256_PREFIX.test(expected)) {
        throw new MemoryShapeError("expected", "file_hash expects a sha256 prefix in lowercase hex.");
      }
      return { schemaVersion: 1, purpose: "grounds", kind, target, expected };
    case "file_contains":
      return { schemaVersion: 1, purpose: "grounds", kind: "text_present", target, expected: literal(expected, "file_contains") };
  }
}

/**
 * The stored or proposed shape of a check, validated per kind and returned fresh with only the
 * validated keys. A legacy sentinel (`{ kind, target, expected }` without a version) is accepted
 * and normalized: `file_contains` becomes `text_present`, the purpose is `grounds`, and there
 * is no `checkId` or `revision` — the catalog assigns those when it puts the check.
 *
 * The evaluator's own normaliser, for its tests and for a caller that hands it raw definitions;
 * not the catalog's. The one the doors and the writers use is `validateCheck` in
 * `packages/db/src/memory-checks.ts`, which also demands the `checkId` and `revision` a stored
 * row carries, and it is the one the package index exports (since 14-Sep-2026; two exported
 * validators of one closed shape had already drifted apart on what they accept).
 */
export function validateCheck(input: unknown): Check {
  if (!isPlainObject(input)) throw new MemoryShapeError("not_object", "A check is an object.");
  if (!("schemaVersion" in input) && typeof input["kind"] === "string" && (LEGACY_KINDS as readonly string[]).includes(input["kind"])) {
    return normalizeLegacy(input);
  }
  assertOnly(input, ["schemaVersion", "checkId", "revision", "purpose", "kind", "target", "expected"], "a check");
  if (input["schemaVersion"] !== 1) throw new MemoryShapeError("schema_version", "A check has schemaVersion 1.");

  const purpose = input["purpose"];
  if (typeof purpose !== "string" || !(CHECK_PURPOSES as readonly string[]).includes(purpose)) {
    throw new MemoryShapeError("unknown_purpose", "A check has one of the four purposes.");
  }
  const kind = input["kind"];
  if (typeof kind !== "string" || !(CHECK_KINDS as readonly string[]).includes(kind)) {
    throw new MemoryShapeError("unknown_kind", "A check has one of the seven kinds.");
  }

  const hasId = input["checkId"] !== undefined;
  const hasRevision = input["revision"] !== undefined;
  if (hasId !== hasRevision) throw new MemoryShapeError("check_id", "A stored check carries both checkId and revision.");
  if (hasId && (typeof input["checkId"] !== "string" || !CHECK_ID.test(input["checkId"]))) {
    throw new MemoryShapeError("check_id", "A check id is chk_ followed by its token.");
  }
  const revision = input["revision"];
  if (hasRevision && (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1)) {
    throw new MemoryShapeError("revision", "A check revision is a whole number from 1.");
  }

  const definition = validateDefinition(kind as CheckKind, validateTarget(input["target"]), input["expected"]);
  const envelope: CheckEnvelope = { schemaVersion: 1, purpose: purpose as CheckPurpose };
  if (hasId) {
    envelope.checkId = input["checkId"] as string;
    envelope.revision = revision as number;
  }
  return { ...envelope, ...definition };
}

// ── Evaluation ────────────────────────────────────────────────────────────────────────────

export type InspectedState = "read" | "missing" | "unreadable" | "too_large" | "outside" | "malformed";

/** One file the evaluator touched; `hash` only when its bytes were read. */
export interface InspectedFile {
  path: string;
  hash?: string;
  state: InspectedState;
}

export type UnknownReason = "limit_reached" | "malformed" | "outside_root" | "unreadable" | "missing";
export type VerdictReason =
  | "exists"
  | "absent"
  | "present"
  | "hash_match"
  | "hash_mismatch"
  | "script_defined"
  | "script_missing"
  | "script_differs"
  | "dependency_declared"
  | "dependency_missing"
  | "version_differs"
  | "key_present"
  | "key_missing"
  | "value_matches"
  | "value_differs";
export type CheckReason = UnknownReason | VerdictReason;

export interface CheckEvaluation {
  result: CheckResult;
  reason: CheckReason;
  inspected: InspectedFile[];
  /** A short, safe detail: the digest seen, the version declared. Never file content. */
  observed?: string;
}

const OBSERVED_MAX = 128;

function unknown(reason: UnknownReason, inspected: InspectedFile[]): CheckEvaluation {
  return { result: "unknown", reason, inspected };
}

function verdict(pass: boolean, reason: VerdictReason, inspected: InspectedFile[], observed?: string): CheckEvaluation {
  const evaluation: CheckEvaluation = { result: pass ? "pass" : "fail", reason, inspected };
  if (observed !== undefined) evaluation.observed = observed.slice(0, OBSERVED_MAX);
  return evaluation;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

function inside(real: string, realRoot: string): boolean {
  return real === realRoot || real.startsWith(realRoot + sep);
}

type Located =
  | { state: "found"; real: string }
  | { state: "missing" }
  | { state: "outside" }
  | { state: "unreadable" };

/**
 * Where the target really is. The lexical resolution keeps the path under the root (the target
 * was validated relative and without `..`), and `realpath` keeps the file there too: a symlink
 * committed inside the project that points outside is `outside`, never followed.
 */
async function locate(realRoot: string, target: string): Promise<Located> {
  const absolute = resolve(realRoot, target);
  if (!inside(absolute, realRoot)) return { state: "outside" };
  try {
    const real = await realpath(absolute);
    return inside(real, realRoot) ? { state: "found", real } : { state: "outside" };
  } catch (error) {
    const code = errorCode(error);
    return code === "ENOENT" || code === "ENOTDIR" ? { state: "missing" } : { state: "unreadable" };
  }
}

type Loaded =
  | { ok: true; bytes: Buffer; hash: string }
  | { ok: false; evaluation: CheckEvaluation };

/** The bytes of a located file, under the cap, or the `unknown` that explains why not. */
async function load(target: string, real: string, limits: CheckLimits): Promise<Loaded> {
  let size: number;
  try {
    const info = await stat(real);
    if (!info.isFile()) return { ok: false, evaluation: unknown("unreadable", [{ path: target, state: "unreadable" }]) };
    size = info.size;
  } catch {
    return { ok: false, evaluation: unknown("unreadable", [{ path: target, state: "unreadable" }]) };
  }
  if (size > limits.fileBytes) return { ok: false, evaluation: unknown("limit_reached", [{ path: target, state: "too_large" }]) };
  try {
    const bytes = await readFile(real);
    if (bytes.byteLength > limits.fileBytes) return { ok: false, evaluation: unknown("limit_reached", [{ path: target, state: "too_large" }]) };
    return { ok: true, bytes, hash: sha256Hex(bytes) };
  } catch {
    return { ok: false, evaluation: unknown("unreadable", [{ path: target, state: "unreadable" }]) };
  }
}

function textOf(bytes: Buffer): string {
  // The byte order mark once, here, like `readTextAt`: invisible to a person, fatal to a parser.
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

type Parsed = { ok: true; document: unknown } | { ok: false };

function parseDocument(format: DocumentFormat, bytes: Buffer): Parsed {
  const text = textOf(bytes);
  try {
    switch (format) {
      case "json":
        return { ok: true, document: JSON.parse(text) };
      case "toml":
        return { ok: true, document: parseToml(text) };
      case "yaml":
        return { ok: true, document: parseYaml(text) };
    }
  } catch {
    // A parser that throws — syntax, a stack it could not afford — is a malformed document.
    return { ok: false };
  }
}

function entriesOf(container: unknown): number | undefined {
  if (Array.isArray(container)) return container.length;
  if (isPlainObject(container)) return Object.keys(container).length;
  return undefined;
}

function childOf(container: unknown, segment: string): unknown {
  if (Array.isArray(container)) {
    if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
    return container[Number(segment)];
  }
  if (isPlainObject(container)) return Object.hasOwn(container, segment) ? container[segment] : undefined;
  return undefined;
}

/**
 * Whether a found value fits the walker's bounds from the depth it was found at: every level
 * below it counts against `documentDepth`, every container against `documentKeys`.
 */
function withinBounds(value: unknown, depth: number, limits: CheckLimits): boolean {
  if (depth > limits.documentDepth) return false;
  const size = entriesOf(value);
  if (size === undefined) return true;
  if (size > limits.documentKeys) return false;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.every((child) => withinBounds(child, depth + 1, limits));
}

function scriptsCheck(document: unknown, expected: ManifestScriptExpected, inspected: InspectedFile[]): CheckEvaluation {
  const scripts = isPlainObject(document) ? document["scripts"] : undefined;
  const definition = isPlainObject(scripts) && Object.hasOwn(scripts, expected.name) ? scripts[expected.name] : undefined;
  if (typeof definition !== "string") return verdict(false, "script_missing", inspected);
  if (expected.definition !== undefined && definition !== expected.definition) return verdict(false, "script_differs", inspected);
  return verdict(true, "script_defined", inspected);
}

function structuredCheck(document: unknown, expected: StructuredKeyExpected, inspected: InspectedFile[], limits: CheckLimits): CheckEvaluation {
  let current: unknown = document;
  for (const [index, segment] of expected.path.entries()) {
    const depth = index + 1;
    if (depth > limits.documentDepth) return unknown("limit_reached", inspected);
    const size = entriesOf(current);
    if (size === undefined) return verdict(false, "key_missing", inspected);
    if (size > limits.documentKeys) return unknown("limit_reached", inspected);
    if (childOf(current, segment) === undefined) return verdict(false, "key_missing", inspected);
    current = childOf(current, segment);
  }
  if (expected.value === undefined) return verdict(true, "key_present", inspected);
  if (!withinBounds(current, expected.path.length + 1, limits)) return unknown("limit_reached", inspected);
  // A TOML date is a value JSON has no type for: it compares as the text TOML wrote it in.
  if (current instanceof Date) current = current.toISOString();
  let actual: string;
  try {
    actual = canonicalJson(current);
  } catch {
    // A value canonical JSON cannot carry is not the expected JSON value.
    return verdict(false, "value_differs", inspected);
  }
  const matches = actual === canonicalJson(expected.value);
  return verdict(matches, matches ? "value_matches" : "value_differs", inspected);
}

// ── Dependency manifests: closed readers, one key each ────────────────────────────────────

/** The declared version of a direct dependency, `null` when declared without one, undefined when absent. */
type Declared = string | null | undefined;

function fromTables(document: unknown, tables: string[], name: string, version: (raw: unknown) => Declared): Declared {
  if (!isPlainObject(document)) return undefined;
  for (const table of tables) {
    const group = document[table];
    if (isPlainObject(group) && Object.hasOwn(group, name)) return version(group[name]);
  }
  return undefined;
}

function npmDeclared(document: unknown, name: string): Declared {
  return fromTables(document, ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"], name, (raw) =>
    typeof raw === "string" ? raw : null,
  );
}

function cargoVersion(raw: unknown): Declared {
  if (typeof raw === "string") return raw;
  if (!isPlainObject(raw)) return null;
  if (typeof raw["version"] === "string") return raw["version"];
  return raw["workspace"] === true ? "workspace" : null;
}

function cargoDeclared(document: unknown, name: string): Declared {
  const direct = fromTables(document, ["dependencies", "dev-dependencies", "build-dependencies"], name, cargoVersion);
  if (direct !== undefined) return direct;
  if (!isPlainObject(document)) return undefined;
  const workspace = document["workspace"];
  const shared = isPlainObject(workspace) ? fromTables(workspace, ["dependencies"], name, cargoVersion) : undefined;
  if (shared !== undefined) return shared;
  const targets = document["target"];
  if (!isPlainObject(targets)) return undefined;
  for (const target of Object.values(targets)) {
    const found = fromTables(target, ["dependencies", "dev-dependencies", "build-dependencies"], name, cargoVersion);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** PEP 503: names compare case-insensitively with runs of `-`, `_` and `.` as one hyphen. */
function normalizePipName(value: string): string {
  return value.toLowerCase().replace(/[-_.]+/g, "-");
}

/** One PEP 508 requirement: the name, its extras dropped, and the specifier text after them. */
function parseRequirement(line: string): { name: string; specifier: string } | undefined {
  const withoutMarker = line.split(";")[0] ?? "";
  const trimmed = withoutMarker.trim();
  if (trimmed.length === 0 || trimmed.startsWith("-") || trimmed.startsWith("#")) return undefined;
  let end = 0;
  while (end < trimmed.length && /[A-Za-z0-9._-]/.test(trimmed[end]!)) end += 1;
  if (end === 0) return undefined;
  const name = trimmed.slice(0, end);
  let rest = trimmed.slice(end).trim();
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close === -1) return undefined;
    rest = rest.slice(close + 1).trim();
  }
  return { name, specifier: rest.replace(/\s+/g, "") };
}

/** A `#` starts a comment at the line start or after whitespace; inside a URL it does not. */
function stripComment(line: string): string {
  if (line.startsWith("#")) return "";
  const at = line.search(/\s#/);
  return at === -1 ? line : line.slice(0, at);
}

function pipDeclared(target: string, document: unknown, text: string | undefined, name: string): Declared {
  const wanted = normalizePipName(name);
  const match = (spec: unknown): Declared => {
    if (typeof spec !== "string") return undefined;
    const requirement = parseRequirement(spec);
    if (!requirement || normalizePipName(requirement.name) !== wanted) return undefined;
    return requirement.specifier.length > 0 ? requirement.specifier : null;
  };
  if (basename(target) === "pyproject.toml") {
    if (!isPlainObject(document)) return undefined;
    const project = document["project"];
    const lists: unknown[] = [];
    if (isPlainObject(project)) {
      lists.push(project["dependencies"]);
      const optional = project["optional-dependencies"];
      if (isPlainObject(optional)) lists.push(...Object.values(optional));
    }
    const groups = document["dependency-groups"];
    if (isPlainObject(groups)) lists.push(...Object.values(groups));
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const spec of list) {
        const found = match(spec);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  for (const line of (text ?? "").split(/\r?\n/)) {
    const found = match(stripComment(line));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** `require x v1` and `require ( … )` blocks of go.mod; `// indirect` lines are not direct. */
function goDeclared(text: string, name: string): Declared {
  let inBlock = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("//")) continue;
    let entry: string | undefined;
    if (inBlock) {
      if (line === ")") {
        inBlock = false;
        continue;
      }
      entry = line;
    } else if (line === "require (") {
      inBlock = true;
      continue;
    } else if (line.startsWith("require ")) {
      entry = line.slice("require ".length);
    }
    if (entry === undefined) continue;
    const [spec, comment] = entry.split("//", 2);
    const [module, version] = (spec ?? "").trim().split(/\s+/);
    if (module !== name || (comment ?? "").includes("indirect")) continue;
    return version && version.length > 0 ? version : null;
  }
  return undefined;
}

function dependencyCheck(target: string, bytes: Buffer, expected: DirectDependencyExpected, inspected: InspectedFile[]): CheckEvaluation {
  let declared: Declared;
  switch (expected.ecosystem) {
    case "npm":
    case "pnpm": {
      const parsed = parseDocument("json", bytes);
      if (!parsed.ok) return unknown("malformed", inspected.map((file) => ({ ...file, state: "malformed" as const })));
      declared = npmDeclared(parsed.document, expected.name);
      break;
    }
    case "cargo": {
      const parsed = parseDocument("toml", bytes);
      if (!parsed.ok) return unknown("malformed", inspected.map((file) => ({ ...file, state: "malformed" as const })));
      declared = cargoDeclared(parsed.document, expected.name);
      break;
    }
    case "pip": {
      if (basename(target) === "pyproject.toml") {
        const parsed = parseDocument("toml", bytes);
        if (!parsed.ok) return unknown("malformed", inspected.map((file) => ({ ...file, state: "malformed" as const })));
        declared = pipDeclared(target, parsed.document, undefined, expected.name);
      } else {
        declared = pipDeclared(target, undefined, textOf(bytes), expected.name);
      }
      break;
    }
    case "go":
      declared = goDeclared(textOf(bytes), expected.name);
      break;
  }
  if (declared === undefined) return verdict(false, "dependency_missing", inspected);
  if (expected.version === undefined) return verdict(true, "dependency_declared", inspected, declared ?? undefined);
  const wanted = expected.version.replace(/\s+/g, "");
  const seen = declared === null ? null : declared.replace(/\s+/g, "");
  return verdict(seen === wanted, seen === wanted ? "dependency_declared" : "version_differs", inspected, declared ?? "unversioned");
}

/**
 * One check against the disk. Pure in the sense that matters: it reads files under `root` and
 * nothing else — no git, no process, no network — and it returns the same answer for the same
 * bytes. `limits` lowers the caps for a caller with less budget.
 */
export async function evaluateCheck(root: string, check: Check, limits: Partial<CheckLimits> = {}): Promise<CheckEvaluation> {
  const bounds: CheckLimits = { ...CHECK_LIMITS, ...limits };
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    // A root that is not on this disk is a world nobody can see from here, not an empty one.
    return unknown("unreadable", []);
  }

  const target = check.target;
  const located = await locate(realRoot, target);
  if (located.state === "outside") return unknown("outside_root", [{ path: target, state: "outside" }]);
  if (located.state === "unreadable") return unknown("unreadable", [{ path: target, state: "unreadable" }]);

  if (check.kind === "path_exists") {
    const exists = located.state === "found";
    const inspected: InspectedFile[] = [{ path: target, state: exists ? "read" : "missing" }];
    return verdict(exists === check.expected, exists ? "exists" : "absent", inspected);
  }
  if (located.state === "missing") return unknown("missing", [{ path: target, state: "missing" }]);

  const loaded = await load(target, located.real, bounds);
  if (!loaded.ok) return loaded.evaluation;
  const inspected: InspectedFile[] = [{ path: target, hash: loaded.hash, state: "read" }];
  const malformed = (): CheckEvaluation => unknown("malformed", [{ path: target, hash: loaded.hash, state: "malformed" }]);

  switch (check.kind) {
    case "file_hash": {
      const matches = check.expected.length === loaded.hash.length ? loaded.hash === check.expected : loaded.hash.startsWith(check.expected);
      return verdict(matches, matches ? "hash_match" : "hash_mismatch", inspected, loaded.hash);
    }
    case "text_present": {
      const present = textOf(loaded.bytes).includes(check.expected);
      return verdict(present, present ? "present" : "absent", inspected);
    }
    case "text_absent": {
      const present = textOf(loaded.bytes).includes(check.expected);
      return verdict(!present, present ? "present" : "absent", inspected);
    }
    case "manifest_script": {
      const parsed = parseDocument("json", loaded.bytes);
      return parsed.ok ? scriptsCheck(parsed.document, check.expected, inspected) : malformed();
    }
    case "direct_dependency":
      return dependencyCheck(target, loaded.bytes, check.expected, inspected);
    case "structured_key": {
      const format = documentFormat(target);
      if (format === undefined) return malformed();
      const parsed = parseDocument(format, loaded.bytes);
      return parsed.ok ? structuredCheck(parsed.document, check.expected, inspected, bounds) : malformed();
    }
  }
}

// ── The environment an observation was made in ────────────────────────────────────────────

export interface Environment {
  schemaVersion: 1;
  environmentId: string;
  /** The caller's private reference for the project; the resolved root when it gives none. */
  projectRef: string;
  resolvedRoot: string;
  /** The commit HEAD names, read from `.git` without git; absent without a repository or on an unborn branch. */
  head?: string;
  /** sha256 of the sorted, unique `path\thash` lines of the inspected files. */
  dirtyFingerprint: string;
  observedAt: string;
  inspected: InspectedFile[];
}

const COMMIT_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const GIT_FILE_MAX = 4 * 1_048_576;

async function readSmall(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > GIT_FILE_MAX) return undefined;
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The commit `.git/HEAD` names, following one `ref:` through the ref file, the common dir of a
 * linked worktree, or `packed-refs`. Never a git command: a worktree the user is working in must
 * not be touched by a process it did not ask for, and a hook that spawned git under a hook would
 * be the recursion the plan forbids.
 */
export async function readGitHead(root: string): Promise<string | undefined> {
  const dotGit = join(root, ".git");
  let gitDir = dotGit;
  try {
    const info = await stat(dotGit);
    if (info.isFile()) {
      const pointer = (await readSmall(dotGit))?.trim() ?? "";
      if (!pointer.startsWith("gitdir:")) return undefined;
      gitDir = resolve(root, pointer.slice("gitdir:".length).trim());
    } else if (!info.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const head = (await readSmall(join(gitDir, "HEAD")))?.trim();
  if (head === undefined) return undefined;
  if (COMMIT_SHA.test(head)) return head;
  if (!head.startsWith("ref:")) return undefined;
  const ref = head.slice("ref:".length).trim();
  if (ref.length === 0 || ref.includes("..") || ref.startsWith("/")) return undefined;

  const commonPointer = (await readSmall(join(gitDir, "commondir")))?.trim();
  const commonDir = commonPointer ? resolve(gitDir, commonPointer) : gitDir;
  for (const base of gitDir === commonDir ? [gitDir] : [gitDir, commonDir]) {
    const value = (await readSmall(join(base, ref)))?.trim();
    if (value !== undefined && COMMIT_SHA.test(value)) return value;
  }
  const packed = await readSmall(join(commonDir, "packed-refs"));
  if (packed === undefined) return undefined;
  for (const line of packed.split(/\r?\n/)) {
    if (line.startsWith("#") || line.startsWith("^")) continue;
    const [sha, name] = line.trim().split(/\s+/, 2);
    if (name === ref && sha !== undefined && COMMIT_SHA.test(sha)) return sha;
  }
  return undefined;
}

/** The line a file contributes to a fingerprint: its hash when read, its state when not. */
function fingerprintLine(file: InspectedFile): string {
  return `${file.path}\t${file.hash ?? file.state}`;
}

/** sha256 of the sorted, unique lines of the inspected files. */
export function inspectedFingerprint(inspected: InspectedFile[]): string {
  const lines = [...new Set(inspected.map(fingerprintLine))].sort();
  return sha256Hex(lines.join("\n"));
}

/** `sha256(resolvedRoot + "\n" + head + "\n" + dirtyFingerprint)`, the identity of an environment. */
export function environmentIdOf(input: { resolvedRoot: string; head?: string; dirtyFingerprint: string }): string {
  return sha256Hex(`${input.resolvedRoot}\n${input.head ?? ""}\n${input.dirtyFingerprint}`);
}

/**
 * The environment of a pass: the root as resolved, HEAD as read, and the fingerprint of what
 * the checks of that pass inspected. The caller passes the union of the `inspected` lists its
 * evaluations returned.
 */
export async function readEnvironment(
  root: string,
  inspected: InspectedFile[],
  options: { projectRef?: string; now?: Date } = {},
): Promise<Environment> {
  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(root);
  } catch {
    resolvedRoot = resolve(root);
  }
  const head = await readGitHead(resolvedRoot);
  const dirtyFingerprint = inspectedFingerprint(inspected);
  const environment: Environment = {
    schemaVersion: 1,
    environmentId: environmentIdOf({ resolvedRoot, head, dirtyFingerprint }),
    projectRef: options.projectRef ?? resolvedRoot,
    resolvedRoot,
    dirtyFingerprint,
    observedAt: (options.now ?? new Date()).toISOString(),
    inspected: inspected.map((file) => ({ ...file })),
  };
  if (head !== undefined) environment.head = head;
  return environment;
}

