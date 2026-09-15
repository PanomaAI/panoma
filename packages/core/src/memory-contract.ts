import { createHash } from "node:crypto";
import type { PredicateNode } from "./predicates";
import { neutralizeInline, neutralizeUntrusted, untrustedFence } from "./untrusted";

/*
  The memory contract, version 2: what an agent receives, and the exact shape in which it is
  recorded so that a receipt can later say which bytes reached which context.

  The contract answers five questions — which rules apply here, what supports them and what
  changes the answer, what remains to be checked, what Panoma offered and what actually appears
  in the recorded context, and what happened afterwards. This module owns the vocabulary and the
  two pieces that must be identical wherever the contract is produced or verified: the canonical
  serialization that is hashed, and the renderer that turns items into the message a program
  emits, with the byte range of every complete unit inside it.

  Three hashes, three jobs, never swapped: `contentHash` identifies the canonical payload — the
  items, checks, coverage, omissions and snapshot, without presentation, contract id or itself;
  `renderedHash` identifies the exact emitted text (`presentation.text`); `revisionHash`
  identifies the full authorized reading of one revision when an item is read by id. None of
  them authenticates the process that writes with the owner's identity, and none proves that a
  model read anything: they let a receipt compare bytes with bytes.

  Everything here is pure: no catalog, no disk, no clock. The server chooses the items and the
  policy; this module says how they are written down. The decision record is docs/memory.md
  and the build plan under private/.
 */

export const MEMORY_CONTRACT_VERSION = 2;
/** Bumped whenever the rendered text of the same items would change byte for byte. */
export const MEMORY_RENDER_VERSION = 1;
/** Bumped whenever the selector's ordering or scoring changes; part of every continuation. */
export const MEMORY_RANKING_VERSION = 1;
/** The canonical serialization the hashes are computed over. */
export const MEMORY_CANONICAL_VERSION = 1;

export type MemoryScope = "global" | "project" | "unresolved";
/** The three public kinds: `note` → notes, `criterion` → beliefs, `decision` → decision_episodes. */
export type MemoryKind = "note" | "criterion" | "decision";
/**
 * What a unit may be, since delivery C: the three archive kinds plus a `commitment` (an open
 * obligation, read whole by id) and a `case` (the projection of a task: asked, decided, declared,
 * checked). The two are never offered by the selector, only read by id, which is why `MemoryKind`
 * stays the vocabulary of offers and `Record<MemoryKind, …>` maps keep compiling.
 */
export type MemoryUnitKind = MemoryKind | "commitment" | "case";
export type MemoryAuthority =
  | "owner_instruction"
  | "owner_confirmation"
  | "owner_report"
  | "agent_report"
  | "observed_result"
  | "inference";
/**
 * Whether the unit applies to the request as declared. `conditional` carries its own conditions
 * or exceptions in narrative form and has not been resolved — nothing in delivery A resolves one
 * by heuristics; `historical` is a revision that is no longer current, delivered because it was
 * asked for by id.
 */
export type MemoryApplicability = "applies" | "conditional" | "historical";
/** What the disk said about the unit's grounds: only notes with sentinels can be verified. */
export type MemoryEvidenceState = "verified" | "unverified" | "challenged" | "unknown";
export type MemoryDeliveryMode = "core" | "contextual";
export type MemoryStatus = "ready" | "requires_check" | "conflict" | "incomplete" | "unavailable";
export type MemoryMode = "orientation" | "action";
export type MemoryOperation = "read" | "edit" | "test" | "build" | "deploy" | "review" | "other";
export type MemoryChannel = "brief" | "signal" | "mcp" | "handoff";
export const MEMORY_CHANNELS: readonly MemoryChannel[] = ["brief", "signal", "mcp", "handoff"];
export const MEMORY_OPERATIONS: readonly MemoryOperation[] = ["read", "edit", "test", "build", "deploy", "review", "other"];
export const MEMORY_KINDS: readonly MemoryKind[] = ["note", "criterion", "decision"];
export const MEMORY_UNIT_KINDS: readonly MemoryUnitKind[] = [...MEMORY_KINDS, "commitment", "case"];

/** The reference every unit carries, with or without its content. */
export interface MemoryItemRef {
  kind: MemoryUnitKind;
  id: string;
  revision: number;
  scope: MemoryScope;
  authority: MemoryAuthority;
  applicability: MemoryApplicability;
  evidenceState: MemoryEvidenceState;
}

/** A complete unit: the rule with its conditions, exceptions and reasons, never a cut. */
export interface MemoryItem extends MemoryItemRef {
  deliveryMode: MemoryDeliveryMode;
  /** The body of a note, the statement of a criterion, the decision text of an episode. */
  text: string;
  rationale?: string;
  conditions?: string;
  exceptions?: string;
  /** A note's `where`, when it sleeps on a path. */
  trigger?: string;
  /** A criterion's topic. */
  topic?: string;
  /** The catalog name the scope resolves to, when it is a project with a name. */
  scopeName?: string;
  /** YYYY-MM-DD of a decision's recording. */
  recordedAt?: string;
  /** The task words that matched, rarest first: the reason it is here, never proof it applies. */
  matched?: string[];
  /** The requested paths a trigger covered. */
  matchedPaths?: string[];
  /** `historical` when the revision is not the current one. */
  use?: "current" | "historical";
  /** Owner-readable record, e.g. `/twin?episode=<id>#episode-<id>`. */
  source?: string;
  /** The note this one replaced (delivery C): the predecessor is superseded and never served. */
  supersedesId?: string;
  /**
   * A criterion's typed conditions (delivery D), rendered as sentences by `renderPredicate`:
   * they travel inside the unit and count in its budget — a criterion never travels without
   * them (plan §10.4). `conditions` stays the narrative of a decision.
   */
  appliesWhen?: string;
  /** A criterion's typed exceptions, rendered the same way. */
  exceptWhen?: string;
}

/**
 * A condition the contract could not resolve: it travels as text, never as a verdict.
 * `requires_check` (delivery C) names a typed check the patrol has not observed fresh in this
 * environment, or a fact the request did not declare: the unit is served conditional with it.
 */
export interface MemoryCheck {
  itemKind: MemoryUnitKind;
  itemId: string;
  revision: number;
  kind: "narrative_condition" | "narrative_exception" | "historical_revision" | "requires_check";
  text: string;
}

export interface MemoryCoverage {
  /** The whole eligible archive was searched (null: not searched, e.g. orientation without a task). */
  searchComplete: boolean | null;
  /** Every required unit — the core and the obligations of the action — is in `items`. */
  requiredComplete: boolean | null;
  /** The project root was readable when the sentinels were patrolled; null when not patrolled. */
  sourceReadable: boolean | null;
  limitsHit: string[];
  candidateCount: number;
}

export interface MemoryOmission {
  reason: string;
  count: number;
  required: boolean;
}

export interface MemorySnapshot {
  audience: "agent" | "hook" | "handoff";
  projectRef: string;
  contextId?: string;
  contextGeneration?: number;
  publicationGeneration: number;
  useGeneration: number;
  grantRefs: string[];
  rankingVersion: number;
  renderVersion: number;
  observedAt: string;
}

export interface MemorySegment {
  revisionHash: string;
  chunkHash: string;
  totalBytes: number;
  start: number;
  end: number;
  complete: boolean;
}

/** One complete unit inside `presentation.text`: `[start, end)` in UTF-8 bytes of that text. */
export interface MemoryUnit {
  kind: MemoryUnitKind;
  id: string;
  revision: number;
  start: number;
  end: number;
  unitHash: string;
}

export interface MemoryUnitManifest {
  schemaVersion: 1;
  units: MemoryUnit[];
}

/** The canonical payload: what `contentHash` covers. */
export interface MemoryPayload {
  schemaVersion: typeof MEMORY_CONTRACT_VERSION;
  status: MemoryStatus;
  items: MemoryItem[];
  checks: MemoryCheck[];
  coverage: MemoryCoverage;
  omissions: MemoryOmission[];
  snapshot: MemorySnapshot;
  /** References of the units that could not travel with their text, for a full read by id. */
  manifest: MemoryItemRef[];
}

export interface MemoryContractV2 extends MemoryPayload {
  contractId: string;
  contentHash: string;
  continuation: string | null;
  presentation: { profile: TransportProfileId; text: string };
  segment?: MemorySegment;
}

// ── Transport profiles ─────────────────────────────────────────────────────────────────────

export type TransportProfileId = "hook-brief-v1" | "hook-signal-v1" | "mcp-memory-v2" | "handoff-memory-v1";

export interface TransportProfile {
  id: TransportProfileId;
  version: 1;
  /** How the final message wraps the text: the hook protocol JSON, the MCP text, a document section. */
  wrapper: "hook-additional-context" | "mcp-text" | "handoff-section";
  /** Maximum Unicode code points of `presentation.text`, when the profile bounds them. */
  maxCodePoints?: number;
  /** Maximum UTF-8 bytes of the final message (wrapper and escaping included). */
  maxSerializedBytes?: number;
  /**
   * Maximum UTF-16 units of the fenced body, the legacy semantics of the edit signal: thirty notes
   * of five hundred with their bullets. Kept for that profile alone; never converted into bytes.
   */
  maxBodyUnits?: number;
  /** The event name the hook wrapper announces. */
  hookEventName?: string;
}

export const TRANSPORT_PROFILES: Record<TransportProfileId, TransportProfile> = {
  "hook-brief-v1": {
    id: "hook-brief-v1",
    version: 1,
    wrapper: "hook-additional-context",
    maxCodePoints: 6_500,
    maxSerializedBytes: 24 * 1024,
    hookEventName: "SessionStart",
  },
  "hook-signal-v1": {
    id: "hook-signal-v1",
    version: 1,
    wrapper: "hook-additional-context",
    maxBodyUnits: 16_000,
    hookEventName: "PreToolUse",
  },
  "mcp-memory-v2": {
    id: "mcp-memory-v2",
    version: 1,
    wrapper: "mcp-text",
    maxSerializedBytes: 24 * 1024,
  },
  "handoff-memory-v1": {
    id: "handoff-memory-v1",
    version: 1,
    wrapper: "handoff-section",
    maxCodePoints: 2_600,
  },
};

// ── Canonical serialization and hashes ───────────────────────────────────────────────────

/**
 * Canonical JSON: object keys sorted, array order preserved, `undefined` members dropped, no
 * whitespace, line breaks inside strings normalized to LF. It never removes a negation, a
 * qualifier, a number or an inner space: canonical means "the same bytes for the same content",
 * not "similar content".
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.replace(/\r\n?/g, "\n");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot carry a non-finite number.");
    return value;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : canonicalize(item)));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const member = record[key];
      if (member === undefined) continue;
      out[key] = canonicalize(member);
    }
    return out;
  }
  throw new TypeError(`Canonical JSON cannot carry a ${typeof value}.`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** SHA-256 hex of the canonical JSON of a value. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function utf8Length(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** The public `contentHash` of a payload. */
export function contentHashOf(payload: MemoryPayload): string {
  return canonicalHash(payload);
}

// ── Validation of what a client may send ─────────────────────────────────────────────────

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID.test(value);
}

export function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** A continuation or cursor token: opaque, bounded, never SQL and never a filesystem offset. */
export function isOpaqueToken(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) return false;
  // No control characters and no spaces: a token travels in a JSON field and in a query string.
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || code === 0x20) return false;
  }
  return true;
}

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === "string" && (MEMORY_KINDS as readonly string[]).includes(value);
}

export function isMemoryUnitKind(value: unknown): value is MemoryUnitKind {
  return typeof value === "string" && (MEMORY_UNIT_KINDS as readonly string[]).includes(value);
}

export function isMemoryOperation(value: unknown): value is MemoryOperation {
  return typeof value === "string" && (MEMORY_OPERATIONS as readonly string[]).includes(value);
}

export function isMemoryChannel(value: unknown): value is MemoryChannel {
  return typeof value === "string" && (MEMORY_CHANNELS as readonly string[]).includes(value);
}

/**
 * The request as a client may phrase it. Unknown properties are rejected by the caller with
 * `invalid_input`: this type only names what may arrive.
 */
export interface MemoryRequestV2 {
  version: 2;
  mode: MemoryMode;
  operation?: MemoryOperation;
  contextId?: string;
  contextGeneration?: number;
  continuation?: string;
  requestId?: string;
}

export interface MemoryReadRequestV2 {
  version: 2;
  read: { kind: MemoryUnitKind; id: string; revision: number; continuation?: string };
}

export type MemoryInvalid = { code: "invalid_input"; error: string };

const REQUEST_KEYS = new Set(["version", "mode", "operation", "contextId", "contextGeneration", "continuation", "requestId", "read"]);
const READ_KEYS = new Set(["kind", "id", "revision", "continuation"]);

/**
 * Parse the `memory` object of a context request. Returns a typed request, a typed read, or a
 * refusal with a fixed English sentence; it never guesses a missing field.
 */
export function parseMemoryRequest(value: unknown): MemoryRequestV2 | MemoryReadRequestV2 | MemoryInvalid {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { code: "invalid_input", error: "memory must be an object." };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!REQUEST_KEYS.has(key)) return { code: "invalid_input", error: `memory.${key} is not a known property.` };
  }
  if (record["version"] !== MEMORY_CONTRACT_VERSION) return { code: "invalid_input", error: "memory.version must be 2." };

  if (record["read"] !== undefined) {
    for (const key of ["mode", "operation", "contextId", "contextGeneration", "continuation", "requestId"]) {
      if (record[key] !== undefined) return { code: "invalid_input", error: `memory.${key} cannot accompany a read.` };
    }
    const read = record["read"];
    if (read === null || typeof read !== "object" || Array.isArray(read)) {
      return { code: "invalid_input", error: "memory.read must be an object." };
    }
    const fields = read as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
      if (!READ_KEYS.has(key)) return { code: "invalid_input", error: `memory.read.${key} is not a known property.` };
    }
    if (!isMemoryUnitKind(fields["kind"])) {
      return { code: "invalid_input", error: "memory.read.kind must be note, criterion, decision, commitment or case." };
    }
    if (!isOpaqueId(fields["id"])) return { code: "invalid_input", error: "memory.read.id must be an opaque id of 1 to 128 characters." };
    if (!isRevision(fields["revision"])) return { code: "invalid_input", error: "memory.read.revision must be a positive integer." };
    if (fields["continuation"] !== undefined && !isOpaqueToken(fields["continuation"])) {
      return { code: "invalid_input", error: "memory.read.continuation must be an opaque token of at most 4,096 characters." };
    }
    return {
      version: 2,
      read: {
        kind: fields["kind"],
        id: fields["id"],
        revision: fields["revision"],
        ...(fields["continuation"] !== undefined ? { continuation: fields["continuation"] as string } : {}),
      },
    };
  }

  const mode = record["mode"];
  if (mode !== "orientation" && mode !== "action") return { code: "invalid_input", error: "memory.mode must be orientation or action." };
  if (record["operation"] !== undefined && !isMemoryOperation(record["operation"])) {
    return { code: "invalid_input", error: "memory.operation is not a known operation." };
  }
  if (record["contextId"] !== undefined && !isOpaqueId(record["contextId"])) {
    return { code: "invalid_input", error: "memory.contextId must be an opaque id of 1 to 128 characters." };
  }
  if (record["contextGeneration"] !== undefined && !isRevision(record["contextGeneration"])) {
    return { code: "invalid_input", error: "memory.contextGeneration must be a positive integer." };
  }
  if (record["continuation"] !== undefined && !isOpaqueToken(record["continuation"])) {
    return { code: "invalid_input", error: "memory.continuation must be an opaque token of at most 4,096 characters." };
  }
  if (record["requestId"] !== undefined && !isOpaqueId(record["requestId"])) {
    return { code: "invalid_input", error: "memory.requestId must be an opaque id of 1 to 128 characters." };
  }
  return {
    version: 2,
    mode,
    ...(record["operation"] !== undefined ? { operation: record["operation"] as MemoryOperation } : {}),
    ...(record["contextId"] !== undefined ? { contextId: record["contextId"] as string } : {}),
    ...(record["contextGeneration"] !== undefined ? { contextGeneration: record["contextGeneration"] as number } : {}),
    ...(record["continuation"] !== undefined ? { continuation: record["continuation"] as string } : {}),
    ...(record["requestId"] !== undefined ? { requestId: record["requestId"] as string } : {}),
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────

/** The receipt marker that opens and closes an emitted message. Never contains the content hash of its own body. */
export const RECEIPT_MARKER = "panoma-memory";

export interface RenderInput {
  contractId: string;
  contentHash: string;
  status: MemoryStatus;
  projectName: string;
  items: MemoryItem[];
  checks: MemoryCheck[];
  omissions: MemoryOmission[];
  coverage: MemoryCoverage;
  /** Units that did not travel with their text and can be read by id. */
  manifest: MemoryItemRef[];
  profile: TransportProfileId;
  /** When the signal profile is emitted for a path, the path the units belong to. */
  path?: string;
}

export interface Rendered {
  text: string;
  units: MemoryUnitManifest;
  /** Bytes of the final message for the profile, wrapper and escaping included. */
  serializedBytes: number;
  codePoints: number;
  /** UTF-16 units of the fenced body, the legacy measure of the edit signal. */
  bodyUnits: number;
}

/** The final message of a profile: what the program receives, and what its limit is measured on. */
export function finalMessage(profile: TransportProfileId, text: string): string {
  const shape = TRANSPORT_PROFILES[profile];
  if (shape.wrapper === "hook-additional-context") {
    return `${JSON.stringify({ hookSpecificOutput: { hookEventName: shape.hookEventName, additionalContext: text } })}\n`;
  }
  return text;
}

/**
 * C0 and C1 control characters except LF and TAB. A rule never needs them, and what prints the
 * message may not keep them: the CLI filters its own output (`apps/cli/src/safe-output.ts`) and
 * strips U+007F–U+009F, which `JSON.stringify` leaves raw, so a unit hashed with one of them would
 * travel without it and never be found intact by the receipt reader. Removed here, before the
 * hash, so that the bytes the offer records are the bytes any printer emits.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

function printable(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

/** A short value on the line: neutralized as any inline foreign value, and printable. */
function inline(value: string, limit?: number): string {
  return neutralizeInline(printable(value), limit);
}

function scopeWord(item: MemoryItem): string {
  if (item.scope === "global") return "every project";
  if (item.scope === "project") return item.scopeName ? `only in ${inline(item.scopeName, 60)}` : "this project";
  return "scope unresolved";
}

function line(value: string): string {
  return neutralizeUntrusted(printable(value.replace(/\r\n?/g, "\n"))).trim();
}

// ── A predicate as sentences ─────────────────────────────────────────────────────────────

function clause(parts: string[], joiner: string): string {
  return parts.length === 1 ? parts[0]! : `(${parts.join(joiner)})`;
}

/**
 * A typed predicate (deliveries C and D) in English sentences, for a reader that has no
 * evaluator: each leaf a short clause, `all` joined by `and`, `any` by `or`, `not` prefixed, and
 * a group in parentheses only when it has more than one member. Closed and deterministic: the
 * same tree renders the same bytes, which is what lets the sentences travel inside a unit,
 * count in its budget and be hashed with it (plan §10.4). Values print as the validator stored
 * them, except an environment id, cut to its first twelve characters — nobody compares one by
 * eye and the whole digest would eat the line. The result is neutralized where it is rendered,
 * like any other body.
 */
export function renderPredicate(node: PredicateNode): string {
  if ("all" in node) return clause(node.all.map(renderPredicate), " and ");
  if ("any" in node) return clause(node.any.map(renderPredicate), " or ");
  if ("not" in node) return `not ${renderPredicate(node.not)}`;
  switch (node.kind) {
    case "project_is": return `the project is ${node.projectId}`;
    case "path_under": return `the path is under ${node.path}`;
    case "operation_is": return `the operation is ${node.operation}`;
    case "environment_is": return `the environment is ${node.environmentId.slice(0, 12)}…`;
    case "task_kind_is": return `the task kind is ${node.taskKind}`;
    case "check_result_is": return `check ${node.checkId} r${node.revision} is ${node.result}`;
  }
}

/**
 * One complete unit, on its own lines: the header names it exactly, the body follows whole.
 *
 * The edit signal keeps the legacy shape — `- <body>` and nothing else — because its envelope
 * was sized for thirty notes of five hundred units and a header per note would eat that margin;
 * the manifest in the catalog still maps every byte range to its note. The one addition since
 * delivery D is a criterion's typed conditions and exceptions, which follow the body on every
 * profile, the signal included: the sentence «Applies when» is part of the rule, not a footnote,
 * and a criterion that does not fit with it is left out whole by the packer rather than served
 * without it (plan §5.2, §10.4).
 */
const BODY_LABEL: Record<MemoryUnitKind, string> = {
  note: "rule",
  criterion: "criterion",
  decision: "decision",
  commitment: "commitment",
  case: "case",
};

function indented(value: string): string {
  return line(value).replace(/\n/g, "\n  ");
}

/** The typed conditions and exceptions of a unit, when it carries them, as the lines that close its body. */
function predicateLines(item: MemoryItem): string[] {
  return [
    ...(item.appliesWhen ? [`  Applies when: ${indented(item.appliesWhen)}`] : []),
    ...(item.exceptWhen ? [`  Except when: ${indented(item.exceptWhen)}`] : []),
  ];
}

export function renderUnit(item: MemoryItem, profile: TransportProfileId = "hook-brief-v1"): string {
  if (profile === "hook-signal-v1") return [`- ${line(item.text)}`, ...predicateLines(item)].join("\n");
  const head = [
    `${item.kind} ${item.id} r${item.revision}`,
    scopeWord(item),
    item.applicability === "conditional" ? "conditional: read the conditions and exceptions before applying"
      : item.applicability === "historical" ? "historical: no longer the current revision" : "applies",
    item.deliveryMode === "core" ? "core" : "contextual",
    ...(item.topic ? [`topic ${inline(item.topic, 40)}`] : []),
    ...(item.recordedAt ? [`recorded ${item.recordedAt}`] : []),
    ...(item.supersedesId ? [`supersedes ${inline(item.supersedesId, 128)}`] : []),
    ...(item.evidenceState === "verified" ? ["grounds verified on disk"]
      : item.evidenceState === "unverified" ? ["grounds not verified"]
      : item.evidenceState === "challenged" ? ["grounds challenged"] : []),
  ].join(" · ");
  const body: string[] = [`- [${head}]`];
  if (item.trigger) body.push(`  where: ${inline(item.trigger, 200)}`);
  if (item.matchedPaths?.length) body.push(`  matches: ${item.matchedPaths.map((path) => inline(path, 200)).join(", ")}`);
  body.push(`  ${BODY_LABEL[item.kind]}: ${indented(item.text)}`);
  if (item.rationale) body.push(`  rationale: ${indented(item.rationale)}`);
  if (item.conditions) body.push(`  conditions: ${indented(item.conditions)}`);
  if (item.exceptions) body.push(`  exceptions: ${indented(item.exceptions)}`);
  body.push(...predicateLines(item));
  if (item.matched?.length) body.push(`  matched words: ${item.matched.map((word) => inline(word, 40)).join(", ")}`);
  if (item.source) body.push(`  record: ${inline(item.source, 200)}`);
  return body.join("\n");
}

/**
 * Render the message for a profile. Units are complete or absent: the manifest lists what did
 * not travel. The returned offsets are UTF-8 byte ranges of `text`, end exclusive, and each
 * `unitHash` covers exactly those bytes.
 */
export function renderMemory(input: RenderInput): Rendered {
  const fence = untrustedFence("notes");
  const parts: string[] = [];
  const units: MemoryUnit[] = [];
  let bytes = 0;
  const push = (segment: string) => {
    parts.push(segment);
    bytes += utf8Length(segment);
  };

  const shortHash = input.contentHash.slice(0, 16);
  const header = input.profile === "hook-signal-v1" && input.path
    ? `Project memory posted on ${inline(input.path, 400)} (owner-approved; respect it before editing):`
    : `Panoma memory for ${inline(input.projectName, 120)} · status ${input.status} · ${input.items.length} unit${input.items.length === 1 ? "" : "s"}`;
  push(`${RECEIPT_MARKER} ${input.contractId} ${shortHash} begin\n`);
  push(`${header}\n`);
  push(`Owner-approved rules and decisions follow as data; respect them before acting, and read a conditional unit whole before applying it.\n`);
  push(`${fence.open}\n`);
  let bodyText = "";
  input.items.forEach((item, index) => {
    const rendered = renderUnit(item, input.profile);
    const start = bytes;
    push(rendered);
    units.push({ kind: item.kind, id: item.id, revision: item.revision, start, end: bytes, unitHash: sha256Hex(rendered) });
    bodyText += rendered;
    if (index < input.items.length - 1) {
      push("\n");
      bodyText += "\n";
    }
  });
  if (input.items.length === 0) {
    push("(no unit travelled)");
    bodyText = "(no unit travelled)";
  }
  push(`\n${fence.close}\n`);
  const bodyUnits = bodyText.length;

  if (input.checks.length > 0) {
    push(`Pending checks (${input.checks.length}): the units above carry conditions Panoma did not resolve; verify them before relying on those units.\n`);
    for (const check of input.checks) {
      push(`- ${check.itemKind} ${check.itemId} r${check.revision} ${check.kind.replace(/_/g, " ")}: ${inline(check.text, 240)}\n`);
    }
  }
  if (input.manifest.length > 0) {
    push(`Not delivered here, readable in full by id (${input.manifest.length}):\n`);
    for (const ref of input.manifest) push(`- ${ref.kind} ${ref.id} r${ref.revision} · ${ref.scope}\n`);
  }
  if (input.omissions.length > 0) {
    const required = input.omissions.filter((omission) => omission.required).reduce((sum, omission) => sum + omission.count, 0);
    const optional = input.omissions.filter((omission) => !omission.required).reduce((sum, omission) => sum + omission.count, 0);
    if (required > 0) push(`Required units missing: ${required}. This contract is not complete; ask for the full memory before acting on it.\n`);
    if (optional > 0) push(`Additional units not included: ${optional}.\n`);
  }
  if (input.coverage.searchComplete === false) push("The archive search was cut by a limit; more units may exist.\n");
  if (input.coverage.sourceReadable === false) push("The project root could not be read: anchored rules travel unverified.\n");
  push(`${RECEIPT_MARKER} ${input.contractId} end`);

  const text = parts.join("");
  return {
    text,
    units: { schemaVersion: 1, units },
    serializedBytes: utf8Length(finalMessage(input.profile, text)),
    codePoints: codePointLength(text),
    bodyUnits,
  };
}

// ── Packing ──────────────────────────────────────────────────────────────────────────────

export interface PackInput extends Omit<RenderInput, "items" | "manifest" | "omissions" | "status" | "coverage"> {
  /** Every candidate, in delivery order: core, then obligations, then the rest. */
  items: MemoryItem[];
  /** Whether each item is required for `ready`: the core and the obligations of the action. */
  required: (item: MemoryItem) => boolean;
  coverage: MemoryCoverage;
  omissions: MemoryOmission[];
  status: MemoryStatus;
}

export interface Packed {
  rendered: Rendered;
  items: MemoryItem[];
  manifest: MemoryItemRef[];
  omissions: MemoryOmission[];
  status: MemoryStatus;
  coverage: MemoryCoverage;
}

function fits(profile: TransportProfile, rendered: Rendered): boolean {
  if (profile.maxCodePoints !== undefined && rendered.codePoints > profile.maxCodePoints) return false;
  if (profile.maxSerializedBytes !== undefined && rendered.serializedBytes > profile.maxSerializedBytes) return false;
  if (profile.maxBodyUnits !== undefined && rendered.bodyUnits > profile.maxBodyUnits) return false;
  return true;
}

function refOf(item: MemoryItem): MemoryItemRef {
  return {
    kind: item.kind, id: item.id, revision: item.revision, scope: item.scope,
    authority: item.authority, applicability: item.applicability, evidenceState: item.evidenceState,
  };
}

/**
 * Fit complete units into a profile. Optional units are dropped from the end until the message
 * fits; a required unit that does not fit makes the contract `incomplete` with the reason
 * `incomplete_core`, and every unit that did not travel is listed in the manifest so that it
 * can be read whole by id. A required unit is never dropped to make room for an optional one.
 */
export function packMemory(input: PackInput): Packed {
  const profile = TRANSPORT_PROFILES[input.profile];
  const required = input.items.filter((item) => input.required(item));
  const optional = input.items.filter((item) => !input.required(item));
  const omissions = [...input.omissions];
  let status = input.status;
  let coverage = input.coverage;

  const attempt = (items: MemoryItem[], manifest: MemoryItemRef[]) => renderMemory({
    contractId: input.contractId,
    contentHash: input.contentHash,
    status,
    projectName: input.projectName,
    items,
    checks: input.checks.filter((check) => items.some((item) => item.kind === check.itemKind && item.id === check.itemId)),
    omissions,
    coverage,
    manifest,
    profile: input.profile,
    ...(input.path !== undefined ? { path: input.path } : {}),
  });

  let kept = optional.length;
  let items = [...required, ...optional];
  let manifest: MemoryItemRef[] = [];
  let rendered = attempt(items, manifest);
  while (!fits(profile, rendered) && kept > 0) {
    kept -= 1;
    items = [...required, ...optional.slice(0, kept)];
    manifest = optional.slice(kept).map(refOf);
    rendered = attempt(items, manifest);
  }
  if (optional.length - kept > 0) {
    omissions.push({ reason: "channel_limit", count: optional.length - kept, required: false });
    rendered = attempt(items, manifest);
  }

  if (!fits(profile, rendered)) {
    // The core alone does not fit: drop required units from the end into the manifest and say so.
    status = "incomplete";
    coverage = { ...coverage, requiredComplete: false, limitsHit: [...coverage.limitsHit, "channel_limit"] };
    let keptRequired = required.length;
    let missing = 0;
    while (!fits(profile, rendered) && keptRequired > 0) {
      keptRequired -= 1;
      missing = required.length - keptRequired;
      items = required.slice(0, keptRequired);
      manifest = [...required.slice(keptRequired).map(refOf), ...optional.map(refOf)];
      const withReason = omissions.filter((omission) => omission.reason !== "incomplete_core");
      omissions.length = 0;
      omissions.push(...withReason, { reason: "incomplete_core", count: missing, required: true });
      rendered = attempt(items, manifest);
    }
  }

  return { rendered, items, manifest, omissions, status, coverage };
}

// ── Reception ────────────────────────────────────────────────────────────────────────────

export type ReceptionResult = "full" | "partial" | "unknown" | "not_observed";

export interface ReceptionCheck {
  result: ReceptionResult;
  /** How many units of the manifest were found intact in the observed text. */
  unitsIntact: number;
  unitsTotal: number;
  /** The observed text hashes exactly like the offer's `presentation.text`. */
  exact: boolean;
}

/**
 * Compare what a native record contains with the offer's manifest. Exact bytes are `full`; the
 * markers alone never are — every unit is looked for by its own hash inside the observed text.
 * A cut unit counts as absent: a prefix of a rule is not the rule.
 *
 * The markers frame the verdict rather than give it. An offer with no unit is `full` only when
 * both markers carry its contract id — one marker is a copy of the header, not the message. An
 * observed text that opens with the offer's own marker but holds none of its units intact is
 * `partial`: the message was observed and nothing of it arrived whole, which is not the same as
 * `not_observed`, the verdict for a text with nothing of the offer in it.
 */
export function checkReception(offer: { rendered: string; renderedHash: string; units: MemoryUnitManifest }, observed: string): ReceptionCheck {
  const total = offer.units.units.length;
  if (sha256Hex(observed) === offer.renderedHash) return { result: "full", unitsIntact: total, unitsTotal: total, exact: true };
  const bytes = Buffer.from(offer.rendered, "utf8");
  let intact = 0;
  for (const unit of offer.units.units) {
    const slice = bytes.subarray(unit.start, unit.end).toString("utf8");
    if (sha256Hex(slice) === unit.unitHash && unitIntactIn(observed, slice)) intact += 1;
  }
  const id = contractIdIn(offer.rendered);
  const opened = id !== undefined && new RegExp(`${RECEIPT_MARKER} ${id} [0-9a-f]{16} begin`).test(observed);
  const closed = id !== undefined && observed.includes(`${RECEIPT_MARKER} ${id} end`);
  if (total === 0) return { result: opened && closed ? "full" : opened ? "partial" : "not_observed", unitsIntact: 0, unitsTotal: 0, exact: false };
  if (intact === total) return { result: "full", unitsIntact: intact, unitsTotal: total, exact: false };
  if (intact > 0 || opened) return { result: "partial", unitsIntact: intact, unitsTotal: total, exact: false };
  return { result: "not_observed", unitsIntact: 0, unitsTotal: total, exact: false };
}

/**
 * A unit is intact only on its own lines: the bytes must appear preceded by a line start and
 * followed by a line end. `second rule` inside `second rules` is not the rule that was offered,
 * and a substring check alone would have sealed it.
 */
function unitIntactIn(observed: string, slice: string): boolean {
  let from = 0;
  while (from <= observed.length) {
    const at = observed.indexOf(slice, from);
    if (at === -1) return false;
    const before = at === 0 ? "\n" : observed[at - 1];
    const after = at + slice.length >= observed.length ? "\n" : observed[at + slice.length];
    if (before === "\n" && after === "\n") return true;
    from = at + 1;
  }
  return false;
}

/** The contract id an emitted message carries, when its opening marker is present. */
export function contractIdIn(text: string): string | undefined {
  const match = new RegExp(`${RECEIPT_MARKER} ([A-Za-z0-9_-]{1,128}) [0-9a-f]{16} begin`).exec(text);
  return match?.[1];
}
