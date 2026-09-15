import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  commitmentAuthority, commitmentPayload, criterionAuthority, criterionPayload, decisionAuthority, decisionPayload,
  noteAuthority, notePayload, recordRevision, scopeOf, type RevisionScopeKind,
} from "./memory-revisions";
import { validMemoryPath } from "./notes";
import { memoryReadBarrier } from "./memory-purge";
import { ALIVE } from "./queries";
import * as t from "./schema";

/**
 * The checks: what a note, a criterion, a decision or a commitment says can be looked at on the
 * disk, written down as a definition with a revision of its own.
 *
 * A sentinel of the first generation was `{ kind, target, expected }` and nothing else: the
 * watcher read it, compared it with the disk and, on a miss, challenged the note. That shape
 * cannot say why the look matters. The same `path_exists` is a foundation on a note («this
 * script exists, so the rule about it holds»), a scope on a criterion («only where there is a
 * `Dockerfile`»), a prohibition on a decision («that literal must not come back») and a
 * finishing line on a commitment («the test file is there»). Four purposes, four different
 * things to do when the look fails, and delivery C makes the purpose a mandatory field:
 * `grounds`, `applicability`, `violation`, `completion`. This module stores the definitions;
 * what happens on a `fail` belongs to the patrol (`apps/web/lib/memory-patrol.ts`), and the
 * plan (§9.1) is explicit that a violation never challenges the rule and a failed completion
 * never closes the obligation.
 *
 * ── A definition has a revision, and observing it moves nothing ──────────────────────────
 *
 * `checkId` names the check for life (`chk_<uuid>`); `revision` starts at 1 and rises only when
 * the definition changes. The change happens in one short transaction that also bumps the
 * domain row's `memory_rev` by compare-and-set, photographs the row (reason `edit`, the checks
 * are part of what the row claims) and photographs the check itself as a revision of kind
 * `check` whose object id is `<domain>:<row id>:<checkId>`. An observation names
 * (`checkId`, `revision`) and therefore always resolves to the exact definition that was looked
 * at, however many times the owner rewrites it afterwards. Observing never touches any of this:
 * `memory-outcomes.ts` writes rows of its own.
 *
 * ── Shape, validated here and not by the evaluator ───────────────────────────────────────
 *
 * Kinds are closed (`path_exists`, `file_hash`, `text_present`, `text_absent`, `manifest_script`,
 * `direct_dependency`, `structured_key`) and `expected` is validated per kind: a boolean, a
 * SHA-256, a literal of at most 2,048 units, a script name, a dependency, a key path. No regular
 * expression, no module name, no command — nothing a definition could smuggle in that would
 * later be *run* rather than *read*. The core evaluator (`packages/core/src/checks-eval.ts`)
 * declares the same closed shape for what it evaluates, with a normaliser of its own for its
 * tests; this is the validator of record — the doors, the writers and the screens read through
 * it, and core does not export its own — because the catalog must know whether a row is well
 * formed without importing the evaluator, and a stored row carries `checkId` and `revision`,
 * which the evaluator's shape does not demand.
 *
 * ── Legacy entries are read, never written ───────────────────────────────────────────────
 *
 * `notes.sentinels` keeps the first-generation shape beside the new one, and
 * `apps/web/lib/sentinels.ts` keeps evaluating it. On read those entries are normalized to the
 * new shape with `checkId = "legacy:<index>"`, `revision 1`, purpose `grounds` and
 * `file_contains` spelled `text_present`, so a screen or the patrol sees one vocabulary. They are
 * never rewritten by this module: their index in the column is their only identity, and their
 * owner is the customs of re-approval, which re-anchors them whole.
 */

export const CHECK_PURPOSES = ["grounds", "applicability", "violation", "completion"] as const;
export type CheckPurpose = typeof CHECK_PURPOSES[number];

export const CHECK_KINDS = [
  "path_exists", "file_hash", "text_present", "text_absent", "manifest_script", "direct_dependency", "structured_key",
] as const;
export type CheckKind = typeof CHECK_KINDS[number];

export const CHECK_ECOSYSTEMS = ["npm", "pnpm", "cargo", "pip", "go"] as const;
export type CheckEcosystem = typeof CHECK_ECOSYSTEMS[number];

export type CheckDomain = "note" | "criterion" | "decision" | "commitment";

/** Where each domain keeps its definitions; a commitment's completion criteria have a column of their own. */
export const CHECK_DOMAINS = {
  note: { table: "notes", column: "sentinels" },
  criterion: { table: "beliefs", column: "checks" },
  decision: { table: "decision_episodes", column: "checks" },
  commitment: { table: "commitments", column: "checks", completionColumn: "completion_checks" },
} as const satisfies Record<CheckDomain, { table: string; column: string; completionColumn?: string }>;

/** A target path or a text literal, in UTF-16 units. */
export const CHECK_TARGET_MAX = 2_048;
export const CHECK_LITERAL_MAX = 2_048;
/** Segments of a structured key path, and the length of a name inside `expected`. */
export const CHECK_PATH_SEGMENTS_MAX = 20;
export const CHECK_NAME_MAX = 256;
/** Completion criteria a commitment may carry (plan §22.9: «hasta seis criterios»). */
export const COMPLETION_CHECKS_MAX = 6;

export interface ManifestScriptExpected {
  name: string;
  /** The script's text as the manifest should define it; compared as text, never run. */
  definition?: string;
}

export interface DirectDependencyExpected {
  ecosystem: CheckEcosystem;
  name: string;
  version?: string;
}

export interface StructuredKeyExpected {
  /** The key path inside the document, one segment per level. */
  path: string[];
  value?: string | number | boolean | null;
}

export type CheckShape =
  | { kind: "path_exists"; expected: boolean }
  | { kind: "file_hash"; expected: string }
  | { kind: "text_present" | "text_absent"; expected: string }
  | { kind: "manifest_script"; expected: ManifestScriptExpected }
  | { kind: "direct_dependency"; expected: DirectDependencyExpected }
  | { kind: "structured_key"; expected: StructuredKeyExpected };

export type CheckExpected = CheckShape["expected"];

export interface CheckHeader {
  schemaVersion: 1;
  /** `chk_<uuid>`, or `legacy:<index>` for a first-generation sentinel seen through `checksOf`. */
  checkId: string;
  revision: number;
  purpose: CheckPurpose;
  /** A relative path inside the project, at most 2,048 units. */
  target: string;
}

export type Check = CheckHeader & CheckShape;

/** What `putCheck` takes: the definition without the fields this module assigns. */
export type CheckInput = { schemaVersion?: 1; checkId?: string; purpose: CheckPurpose; target: string } & CheckShape;

export type PutCheckResult =
  | { checkId: string; revision: number; memoryRev: number }
  | { conflict: true }
  | { notFound: true };

export interface CheckCounts {
  notes: number;
  criteria: number;
  decisions: number;
  commitments: number;
  total: number;
}

/** A definition that is not one: the route answers `400 invalid_check` with `reason`. */
export class InvalidCheck extends TypeError {
  readonly code = "invalid_check" as const;
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "InvalidCheck";
  }
}

const LEGACY_KINDS = ["path_exists", "file_hash", "file_contains"] as const;
const CHECK_ID = /^chk_[A-Za-z0-9_-]{1,64}$/;
const LEGACY_ID = /^legacy:\d{1,6}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** The first generation stored a 16-hex prefix of the digest; a whole one is accepted too. */
const LEGACY_HASH = /^[0-9a-f]{16,64}$/;
const STRUCTURED_EXTENSION = /\.(json|toml|ya?ml)$/i;
const NOTE_ALIVE = ["proposed", "approved", "challenged"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(reason: string, message: string): never {
  throw new InvalidCheck(reason, message);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid("unknown_key", `A check ${where} has an unknown key.`);
  }
}

/** A short name: no whitespace, no control characters, bounded. Compared as text, never run. */
function isName(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\p{Cc}]/u.test(value);
}

function validTarget(value: unknown, reason: string): string {
  if (typeof value !== "string") invalid(reason, "A check target is a relative path.");
  if (value.length > CHECK_TARGET_MAX) invalid(`${reason}_length`, "A check target is at most 2,048 units.");
  if (!validMemoryPath(value)) invalid(reason, "A check target is a bounded relative path inside the project.");
  return value;
}

function literal(value: unknown, reason: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(reason, "The expected value is a text literal.");
  if (value.length > CHECK_LITERAL_MAX) invalid(`${reason}_length`, "The expected literal is at most 2,048 units.");
  return value;
}

function expectedFor(kind: CheckKind, value: unknown): CheckExpected {
  switch (kind) {
    case "path_exists":
      if (typeof value !== "boolean") invalid("expected_boolean", "A path_exists check expects a boolean.");
      return value;
    case "file_hash":
      if (typeof value !== "string" || !SHA256_HEX.test(value)) invalid("expected_sha256", "A file_hash check expects a SHA-256 in lowercase hex.");
      return value;
    case "text_present":
    case "text_absent":
      return literal(value, "expected_literal");
    case "manifest_script": {
      if (!isRecord(value)) invalid("expected_script", "A manifest_script check expects { name, definition? }.");
      onlyKeys(value, ["name", "definition"], "expected");
      if (!isName(value["name"], CHECK_NAME_MAX)) invalid("expected_name", "A script name is a short name without spaces.");
      const expected: ManifestScriptExpected = { name: value["name"] };
      if (value["definition"] !== undefined) expected.definition = literal(value["definition"], "expected_definition");
      return expected;
    }
    case "direct_dependency": {
      if (!isRecord(value)) invalid("expected_dependency", "A direct_dependency check expects { ecosystem, name, version? }.");
      onlyKeys(value, ["ecosystem", "name", "version"], "expected");
      if (!(CHECK_ECOSYSTEMS as readonly unknown[]).includes(value["ecosystem"])) invalid("expected_ecosystem", "Unknown dependency ecosystem.");
      if (!isName(value["name"], CHECK_NAME_MAX)) invalid("expected_name", "A dependency name is a short name without spaces.");
      const expected: DirectDependencyExpected = { ecosystem: value["ecosystem"] as CheckEcosystem, name: value["name"] };
      if (value["version"] !== undefined) {
        if (!isName(value["version"], CHECK_NAME_MAX)) invalid("expected_version", "A dependency version is a short text without spaces.");
        expected.version = value["version"];
      }
      return expected;
    }
    case "structured_key": {
      if (!isRecord(value)) invalid("expected_key", "A structured_key check expects { path, value? }.");
      onlyKeys(value, ["path", "value"], "expected");
      const path = value["path"];
      if (!Array.isArray(path) || path.length === 0) invalid("expected_path", "A key path is a non-empty list of segments.");
      if (path.length > CHECK_PATH_SEGMENTS_MAX) invalid("expected_path_length", "A key path has at most 20 segments.");
      for (const segment of path) {
        if (typeof segment !== "string" || segment.length === 0 || segment.length > CHECK_NAME_MAX || /\p{Cc}/u.test(segment)) {
          invalid("expected_path", "A key path segment is a short text.");
        }
      }
      const expected: StructuredKeyExpected = { path: [...(path as string[])] };
      const found = value["value"];
      if (found !== undefined) {
        if (typeof found === "string") {
          if (found.length > CHECK_LITERAL_MAX) invalid("expected_value_length", "An expected value is at most 2,048 units.");
        } else if (typeof found === "number") {
          if (!Number.isFinite(found)) invalid("expected_value", "An expected number is finite.");
        } else if (typeof found !== "boolean" && found !== null) {
          invalid("expected_value", "An expected value is a string, a number, a boolean or null.");
        }
        expected.value = found as StructuredKeyExpected["value"];
      }
      return expected;
    }
  }
}

function shapeOf(kind: unknown, target: string, expected: unknown): CheckShape {
  if (!(CHECK_KINDS as readonly unknown[]).includes(kind)) invalid("kind", "Unknown check kind.");
  const known = kind as CheckKind;
  if (known === "structured_key" && !STRUCTURED_EXTENSION.test(target)) invalid("target", "A structured_key check targets a JSON, TOML or YAML file.");
  return { kind: known, expected: expectedFor(known, expected) } as CheckShape;
}

function purposeOf(value: unknown): CheckPurpose {
  if (!(CHECK_PURPOSES as readonly unknown[]).includes(value)) invalid("purpose", "Unknown check purpose.");
  return value as CheckPurpose;
}

/** A first-generation sentinel: exactly `{ kind, target, expected }` with one of its three kinds. */
function isLegacy(value: Record<string, unknown>): boolean {
  return !("schemaVersion" in value) && !("checkId" in value) && (LEGACY_KINDS as readonly unknown[]).includes(value["kind"]);
}

function normalizeLegacy(value: Record<string, unknown>, index: number): Check {
  onlyKeys(value, ["kind", "target", "expected"], "of the first generation");
  const target = validTarget(value["target"], "target");
  const header: CheckHeader = { schemaVersion: 1, checkId: `legacy:${index}`, revision: 1, purpose: "grounds", target };
  const expected = value["expected"];
  switch (value["kind"]) {
    case "path_exists":
      if (typeof expected !== "boolean") invalid("expected_boolean", "A path_exists sentinel expects a boolean.");
      return { ...header, kind: "path_exists", expected };
    case "file_hash":
      if (typeof expected !== "string" || !LEGACY_HASH.test(expected)) invalid("expected_sha256", "A file_hash sentinel expects a hex digest.");
      return { ...header, kind: "file_hash", expected };
    default:
      // Inherited content is kept whole even past the new literal cap (plan §25.2).
      if (typeof expected !== "string" || expected.length === 0) invalid("expected_literal", "A file_contains sentinel expects a text literal.");
      return { ...header, kind: "text_present", expected };
  }
}

/**
 * The closed shape, or an `InvalidCheck` naming what is wrong and never echoing the value. A
 * first-generation sentinel is accepted and normalized; `legacyIndex` is its position in the
 * column, which is the only identity it has.
 */
export function validateCheck(input: unknown, options: { legacyIndex?: number } = {}): Check {
  if (!isRecord(input)) invalid("shape", "A check is an object.");
  if (isLegacy(input)) return normalizeLegacy(input, options.legacyIndex ?? 0);
  onlyKeys(input, ["schemaVersion", "checkId", "revision", "purpose", "kind", "target", "expected"], "");
  if (input["schemaVersion"] !== 1) invalid("schema_version", "A check carries schema version 1.");
  const checkId = input["checkId"];
  if (typeof checkId !== "string" || !(CHECK_ID.test(checkId) || LEGACY_ID.test(checkId))) invalid("check_id", "A check id is a bounded chk_ identifier.");
  const revision = input["revision"];
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) invalid("revision", "A check revision is a positive integer.");
  const target = validTarget(input["target"], "target");
  return {
    schemaVersion: 1,
    checkId,
    revision: revision as number,
    purpose: purposeOf(input["purpose"]),
    target,
    ...shapeOf(input["kind"], target, input["expected"]),
  };
}

/** The definition a caller brings to `putCheck`: everything but the fields this module assigns. */
function validateInput(domain: CheckDomain, input: CheckInput): { checkId: string | undefined; purpose: CheckPurpose; target: string } & CheckShape {
  if (!isRecord(input)) invalid("shape", "A check is an object.");
  const record = input as unknown as Record<string, unknown>;
  onlyKeys(record, ["schemaVersion", "checkId", "purpose", "kind", "target", "expected"], "");
  if (record["schemaVersion"] !== undefined && record["schemaVersion"] !== 1) invalid("schema_version", "A check carries schema version 1.");
  const checkId = record["checkId"];
  if (checkId !== undefined) {
    if (typeof checkId === "string" && LEGACY_ID.test(checkId)) invalid("legacy", "A first-generation sentinel is re-anchored by approval, never edited here.");
    if (typeof checkId !== "string" || !CHECK_ID.test(checkId)) invalid("check_id", "A check id is a bounded chk_ identifier.");
  }
  const purpose = purposeOf(record["purpose"]);
  if (purpose === "completion" && domain !== "commitment") invalid("purpose_domain", "Only a commitment has completion criteria.");
  const target = validTarget(record["target"], "target");
  return { checkId: checkId as string | undefined, purpose, target, ...shapeOf(record["kind"], target, record["expected"]) };
}

function assertDomain(domain: string): asserts domain is CheckDomain {
  if (!(domain in CHECK_DOMAINS)) throw new TypeError("Unknown check domain.");
}

function expectedRev(expected: { memoryRev: number }): number {
  if (!isRecord(expected) || !Number.isSafeInteger(expected.memoryRev) || expected.memoryRev < 1) throw new TypeError("The expected memory revision is a positive integer.");
  return expected.memoryRev;
}

function entriesOf(column: unknown): unknown[] {
  return Array.isArray(column) ? column : [];
}

/** The stored entries as checks, legacy ones normalized by their position. */
function normalized(entries: unknown[]): Check[] {
  return entries.map((entry, index) => validateCheck(entry, { legacyIndex: index }));
}

// ── The domain rows: lock, read, write and photograph ───────────────────────────

interface Columns {
  checks: unknown[];
  /** Only a commitment has it; null elsewhere. */
  completion: unknown[] | null;
}

interface Locked extends Columns {
  memoryRev: number;
  scope: { scopeKind: RevisionScopeKind; scopeRef: string | null };
  /** The compare-and-set update and the photograph; undefined when the revision moved meanwhile. */
  write: (tx: Database, next: Columns, expectedRev: number) => Promise<{ memoryRev: number } | undefined>;
}

async function lockNote(tx: Database, id: string): Promise<Locked | undefined> {
  const alive = and(eq(t.notes.id, id), inArray(t.notes.status, NOTE_ALIVE), await memoryReadBarrier(tx, "note", t.notes.id));
  // The project lock first, then the row: the order of `decideNote` and `setSentinels`.
  const [owner] = await tx.select({ projectId: t.notes.projectId }).from(t.notes).where(alive).limit(1);
  if (!owner) return undefined;
  await tx.select({ id: t.projects.id }).from(t.projects).where(eq(t.projects.id, owner.projectId)).for("update");
  const [row] = await tx.select().from(t.notes).where(alive).for("update");
  if (!row) return undefined;
  return {
    memoryRev: row.memoryRev,
    checks: entriesOf(row.sentinels),
    completion: null,
    scope: { scopeKind: "project", scopeRef: row.projectId },
    write: async (tx, next, expectedRev) => {
      const [moved] = await tx.update(t.notes)
        .set({ sentinels: next.checks, memoryRev: sql`${t.notes.memoryRev} + 1` })
        .where(and(alive, eq(t.notes.memoryRev, expectedRev)))
        .returning();
      if (!moved) return undefined;
      await recordRevision(tx, {
        kind: "note", objectId: moved.id, rev: moved.memoryRev, scopeKind: "project", scopeRef: moved.projectId,
        authority: noteAuthority(moved), disposition: moved.status, payload: notePayload(moved), reason: "edit",
      });
      return { memoryRev: moved.memoryRev };
    },
  };
}

async function lockCriterion(tx: Database, id: string): Promise<Locked | undefined> {
  const alive = and(eq(t.beliefs.id, id), inArray(t.beliefs.state, ALIVE), await memoryReadBarrier(tx, "criterion", t.beliefs.id));
  const [row] = await tx.select().from(t.beliefs).where(alive).for("update");
  if (!row) return undefined;
  return {
    memoryRev: row.memoryRev,
    checks: entriesOf(row.checks),
    completion: null,
    scope: scopeOf(row.scopeKind, row.identity),
    write: async (tx, next, expectedRev) => {
      const [moved] = await tx.update(t.beliefs)
        .set({ checks: next.checks as Record<string, unknown>[], memoryRev: sql`${t.beliefs.memoryRev} + 1` })
        .where(and(alive, eq(t.beliefs.memoryRev, expectedRev)))
        .returning();
      if (!moved) return undefined;
      await recordRevision(tx, {
        kind: "criterion", objectId: moved.id, rev: moved.memoryRev, ...scopeOf(moved.scopeKind, moved.identity),
        authority: criterionAuthority(moved), disposition: moved.state,
        // The builder predates the column; spreading it keeps the photograph equal once the builder learns it.
        payload: criterionPayload(moved), reason: "edit",
      });
      return { memoryRev: moved.memoryRev };
    },
  };
}

async function lockDecision(tx: Database, id: string): Promise<Locked | undefined> {
  // The same table lock as `episodeWrite`, taken first, so the two writers never wait on each other's row.
  await tx.execute(sql`lock table ${t.decisionEpisodes} in share row exclusive mode`);
  const alive = and(eq(t.decisionEpisodes.id, id), eq(t.decisionEpisodes.status, "active"), await memoryReadBarrier(tx, "decision", t.decisionEpisodes.id));
  const [row] = await tx.select().from(t.decisionEpisodes).where(alive).limit(1);
  if (!row) return undefined;
  return {
    memoryRev: row.memoryRev,
    checks: entriesOf(row.checks),
    completion: null,
    scope: scopeOf(row.scopeKind, row.identity),
    write: async (tx, next, expectedRev) => {
      const [moved] = await tx.update(t.decisionEpisodes)
        .set({ checks: next.checks as Record<string, unknown>[], memoryRev: sql`${t.decisionEpisodes.memoryRev} + 1` })
        .where(and(alive, eq(t.decisionEpisodes.memoryRev, expectedRev)))
        .returning();
      if (!moved) return undefined;
      await recordRevision(tx, {
        kind: "decision", objectId: moved.id, rev: moved.memoryRev, ...scopeOf(moved.scopeKind, moved.identity),
        authority: decisionAuthority(moved), disposition: moved.status, payload: decisionPayload(moved), reason: "edit",
      });
      return { memoryRev: moved.memoryRev };
    },
  };
}

async function lockCommitment(tx: Database, id: string): Promise<Locked | undefined> {
  const alive = and(eq(t.commitments.id, id), eq(t.commitments.status, "open"), await memoryReadBarrier(tx, "commitment", t.commitments.id));
  const [row] = await tx.select().from(t.commitments).where(alive).for("update");
  if (!row) return undefined;
  return {
    memoryRev: row.memoryRev,
    checks: entriesOf(row.checks),
    completion: entriesOf(row.completionChecks),
    scope: { scopeKind: "project", scopeRef: row.projectId },
    write: async (tx, next, expectedRev) => {
      const [moved] = await tx.update(t.commitments)
        .set({
          checks: next.checks as Record<string, unknown>[],
          completionChecks: (next.completion ?? []) as Record<string, unknown>[],
          memoryRev: sql`${t.commitments.memoryRev} + 1`,
        })
        .where(and(alive, eq(t.commitments.memoryRev, expectedRev)))
        .returning();
      if (!moved) return undefined;
      await recordRevision(tx, {
        kind: "commitment", objectId: moved.id, rev: moved.memoryRev, scopeKind: "project", scopeRef: moved.projectId,
        authority: commitmentAuthority(moved), disposition: moved.status, payload: commitmentPayload(moved), reason: "edit",
      });
      return { memoryRev: moved.memoryRev };
    },
  };
}

function lock(tx: Database, domain: CheckDomain, id: string): Promise<Locked | undefined> {
  switch (domain) {
    case "note": return lockNote(tx, id);
    case "criterion": return lockCriterion(tx, id);
    case "decision": return lockDecision(tx, id);
    case "commitment": return lockCommitment(tx, id);
  }
}

/** The position of a new-shape entry by id; legacy entries carry no id and never match. */
function indexOf(entries: unknown[], checkId: string): number {
  return entries.findIndex((entry) => isRecord(entry) && entry["checkId"] === checkId);
}

/** The check revision row: the definition at that number, or its absence once removed. */
async function photographCheck(
  tx: Database,
  domain: CheckDomain,
  id: string,
  scope: Locked["scope"],
  check: { checkId: string; revision: number },
  definition: Check | null,
): Promise<void> {
  await recordRevision(tx, {
    kind: "check",
    objectId: `${domain}:${id}:${check.checkId}`,
    rev: check.revision,
    ...scope,
    authority: "owner_instruction",
    disposition: definition ? "defined" : "removed",
    payload: { domain, objectId: id, checkId: check.checkId, revision: check.revision, definition },
    reason: definition && check.revision === 1 ? "create" : "edit",
  });
}

// ── Public surface ──────────────────────────────────────────────────────────────

/** The checks of one row, legacy sentinels normalized by position; a commitment's completion criteria last. */
export async function checksOf(db: Database, domain: CheckDomain, id: string): Promise<Check[]> {
  assertDomain(domain);
  switch (domain) {
    case "note": {
      const [row] = await db.select({ sentinels: t.notes.sentinels }).from(t.notes).where(and(eq(t.notes.id, id), await memoryReadBarrier(db, "note", t.notes.id))).limit(1);
      return row ? normalized(entriesOf(row.sentinels)) : [];
    }
    case "criterion": {
      const [row] = await db.select({ checks: t.beliefs.checks }).from(t.beliefs).where(and(eq(t.beliefs.id, id), await memoryReadBarrier(db, "criterion", t.beliefs.id))).limit(1);
      return row ? normalized(entriesOf(row.checks)) : [];
    }
    case "decision": {
      const [row] = await db.select({ checks: t.decisionEpisodes.checks }).from(t.decisionEpisodes).where(and(eq(t.decisionEpisodes.id, id), await memoryReadBarrier(db, "decision", t.decisionEpisodes.id))).limit(1);
      return row ? normalized(entriesOf(row.checks)) : [];
    }
    case "commitment": {
      const [row] = await db.select({ checks: t.commitments.checks, completion: t.commitments.completionChecks })
        .from(t.commitments).where(and(eq(t.commitments.id, id), await memoryReadBarrier(db, "commitment", t.commitments.id))).limit(1);
      return row ? [...normalized(entriesOf(row.checks)), ...normalized(entriesOf(row.completion))] : [];
    }
  }
}

/**
 * Create a check (no `checkId`: revision 1) or modify one (`checkId`: revision + 1), by
 * compare-and-set on the row's `memory_rev`. One short transaction updates the column, bumps the
 * revision, photographs the row and photographs the check. A missing or closed row, or a
 * `checkId` the row does not carry, is `notFound`; a moved revision is `conflict`; a malformed
 * definition throws `InvalidCheck` before anything is touched.
 */
export async function putCheck(
  db: Database,
  domain: CheckDomain,
  id: string,
  input: CheckInput,
  expected: { memoryRev: number },
): Promise<PutCheckResult> {
  assertDomain(domain);
  const memoryRev = expectedRev(expected);
  const draft = validateInput(domain, input);
  return db.transaction(async (tx) => {
    const locked = await lock(tx, domain, id);
    if (!locked) return { notFound: true };
    if (locked.memoryRev !== memoryRev) return { conflict: true };

    const routed: "checks" | "completion" = draft.purpose === "completion" ? "completion" : "checks";
    const next: Columns = { checks: [...locked.checks], completion: locked.completion ? [...locked.completion] : null };
    let check: Check;
    if (draft.checkId === undefined) {
      check = { schemaVersion: 1, checkId: `chk_${randomUUID()}`, revision: 1, purpose: draft.purpose, target: draft.target, kind: draft.kind, expected: draft.expected } as Check;
      (routed === "completion" ? next.completion! : next.checks).push(check);
    } else {
      const inChecks = indexOf(next.checks, draft.checkId);
      const inCompletion = next.completion ? indexOf(next.completion, draft.checkId) : -1;
      if (inChecks < 0 && inCompletion < 0) return { notFound: true };
      const current = validateCheck(inChecks >= 0 ? next.checks[inChecks] : next.completion![inCompletion]);
      check = { schemaVersion: 1, checkId: draft.checkId, revision: current.revision + 1, purpose: draft.purpose, target: draft.target, kind: draft.kind, expected: draft.expected } as Check;
      const from: "checks" | "completion" = inChecks >= 0 ? "checks" : "completion";
      if (from === routed) {
        (routed === "completion" ? next.completion! : next.checks)[from === "checks" ? inChecks : inCompletion] = check;
      } else {
        if (from === "checks") next.checks.splice(inChecks, 1); else next.completion!.splice(inCompletion, 1);
        (routed === "completion" ? next.completion! : next.checks).push(check);
      }
    }
    if (next.completion && next.completion.length > COMPLETION_CHECKS_MAX) invalid("completion_limit", "A commitment carries at most six completion criteria.");

    const moved = await locked.write(tx, next, memoryRev);
    if (!moved) return { conflict: true };
    await photographCheck(tx, domain, id, locked.scope, check, check);
    return { checkId: check.checkId, revision: check.revision, memoryRev: moved.memoryRev };
  });
}

/**
 * Remove a check by compare-and-set on `memory_rev`: the row is photographed without it and the
 * check gets a closing revision (`definition: null`). False when the row is missing or closed,
 * the revision moved, or the row does not carry that id; a legacy id throws, because a
 * first-generation sentinel is re-anchored by approval and not edited here.
 */
export async function removeCheck(
  db: Database,
  domain: CheckDomain,
  id: string,
  checkId: string,
  expected: { memoryRev: number },
): Promise<boolean> {
  assertDomain(domain);
  const memoryRev = expectedRev(expected);
  if (typeof checkId === "string" && LEGACY_ID.test(checkId)) invalid("legacy", "A first-generation sentinel is re-anchored by approval, never removed here.");
  if (typeof checkId !== "string" || !CHECK_ID.test(checkId)) invalid("check_id", "A check id is a bounded chk_ identifier.");
  return db.transaction(async (tx) => {
    const locked = await lock(tx, domain, id);
    if (!locked || locked.memoryRev !== memoryRev) return false;
    const inChecks = indexOf(locked.checks, checkId);
    const inCompletion = locked.completion ? indexOf(locked.completion, checkId) : -1;
    if (inChecks < 0 && inCompletion < 0) return false;
    const current = validateCheck(inChecks >= 0 ? locked.checks[inChecks] : locked.completion![inCompletion]);
    const next: Columns = {
      checks: inChecks >= 0 ? locked.checks.filter((_, index) => index !== inChecks) : [...locked.checks],
      completion: locked.completion ? (inCompletion >= 0 ? locked.completion.filter((_, index) => index !== inCompletion) : [...locked.completion]) : null,
    };
    const moved = await locked.write(tx, next, memoryRev);
    if (!moved) return false;
    await photographCheck(tx, domain, id, locked.scope, { checkId, revision: current.revision + 1 }, null);
    return true;
  });
}

/** Definitions on the live rows of one project: notes by project, criteria and decisions by identity, commitments by project. */
export async function checkCount(db: Database, projectId: string): Promise<CheckCounts> {
  const [project] = await db.select({ identity: t.projects.identity }).from(t.projects).where(eq(t.projects.id, projectId)).limit(1);
  if (!project) return { notes: 0, criteria: 0, decisions: 0, commitments: 0, total: 0 };
  const [notes] = await db.select({ n: sql<number>`coalesce(sum(jsonb_array_length(${t.notes.sentinels})), 0)::int` })
    .from(t.notes).where(and(eq(t.notes.projectId, projectId), inArray(t.notes.status, NOTE_ALIVE), await memoryReadBarrier(db, "note", t.notes.id)));
  const [commitments] = await db.select({
    n: sql<number>`coalesce(sum(jsonb_array_length(${t.commitments.checks}) + jsonb_array_length(${t.commitments.completionChecks})), 0)::int`,
  }).from(t.commitments).where(and(eq(t.commitments.projectId, projectId), eq(t.commitments.status, "open"), await memoryReadBarrier(db, "commitment", t.commitments.id)));
  let criteria = 0;
  let decisions = 0;
  if (project.identity !== null) {
    const [beliefs] = await db.select({ n: sql<number>`coalesce(sum(jsonb_array_length(${t.beliefs.checks})), 0)::int` })
      .from(t.beliefs).where(and(eq(t.beliefs.identity, project.identity), inArray(t.beliefs.state, ALIVE), await memoryReadBarrier(db, "criterion", t.beliefs.id)));
    const [episodes] = await db.select({ n: sql<number>`coalesce(sum(jsonb_array_length(${t.decisionEpisodes.checks})), 0)::int` })
      .from(t.decisionEpisodes).where(and(eq(t.decisionEpisodes.identity, project.identity), eq(t.decisionEpisodes.status, "active"), await memoryReadBarrier(db, "decision", t.decisionEpisodes.id)));
    criteria = beliefs?.n ?? 0;
    decisions = episodes?.n ?? 0;
  }
  const counts = { notes: notes?.n ?? 0, criteria, decisions, commitments: commitments?.n ?? 0 };
  return { ...counts, total: counts.notes + counts.criteria + counts.decisions + counts.commitments };
}
