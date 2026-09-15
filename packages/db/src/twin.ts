import { validatePredicate, type Predicate } from "@panoma/core";
import { desc, eq } from "drizzle-orm";
import type { Database } from "./client";
import * as schema from "./schema";

/** The latest completed synthesis and its durable job reference, for the incremental grouping gate. */
export async function lastTopicSynthesis(database: Database, topic: string) {
  const [row] = await database.select().from(schema.synthesisPasses).where(eq(schema.synthesisPasses.topic, topic))
    .orderBy(desc(schema.synthesisPasses.at), desc(schema.synthesisPasses.id)).limit(1);
  return row;
}

/*
  The vocabulary of the contextual Twin (delivery D, plan §10.1, §10.2, §22.10).

  A criterion no longer ends at its sentence: since this delivery it may carry typed conditions
  and exceptions —a predicate of `packages/core/src/predicates.ts`, the same closed union a
  decision or a commitment uses— and an object that says how independent the evidence behind an
  inference is. This module holds the shapes and the validators of those three columns, and
  nothing that reads or writes the catalog: `queries.ts` keeps the belief writers, which import
  the validators from here, and `support-families.ts` computes the evidence from real
  observations. Keeping the vocabulary apart from the writers is what lets both of them import it
  without importing each other.

  ── The case origin key ─────────────────────────────────────────────────────────────────

  Independence is counted by the origin of the case, not by the number of messages, agents or
  days (§10.2). An observation names where its quotes came from: `<harness>:<native session
  key>:<recipient>` for a human turn read from a stream, `teach:<gesture id>` for a lesson the
  owner typed. A copy, a relay, a compaction summary or the system's own output carries the
  `copied:` prefix and never founds a family; `unknown` is the word for an origin nobody could
  establish, and it never counts either. Legacy rows carry null: their origin was never recorded,
  and this module refuses to invent one for them.

  ── The support evidence ────────────────────────────────────────────────────────────────

  `beliefs.support_evidence` is the closed object the publication gate reads: the families of
  known origin behind an inference, their counts and the observations they cite. It is derived
  from the observations' origin keys and never from a model's opinion, and it is not another
  score: `beliefs.support` keeps the legacy floor (`standsUp`) and this object adds the three
  independent families delivery D requires of a new or revised inference. A legacy inference
  keeps null and its policy; nothing here rebuilds fictitious families for old counters.
 */

/** The policy under which `support_evidence` is computed; version 1 is the legacy `support` floor. */
export const SUPPORT_POLICY_VERSION = 2;

/** How many independent families a new or revised inference needs to publish automatically. */
export const SUPPORT_FAMILIES_FLOOR = 3;

/** The longest origin key a writer accepts: a harness, a native session key and a recipient. */
export const CASE_ORIGIN_KEY_MAX = 512;

/** A copy, a relay, a compaction summary or the system's own output: never a family. */
export const COPIED_ORIGIN_PREFIX = "copied:";

/** A lesson the owner typed: one family per gesture. */
export const TEACH_ORIGIN_PREFIX = "teach:";

/** The origin nobody could establish. It is stored as it is and never counts. */
export const UNKNOWN_ORIGIN = "unknown";

/** Bounds of the stored evidence object; a caller that exceeds them is refused, never trimmed. */
export const SUPPORT_FAMILIES_MAX = 200;
export const SUPPORT_REFS_MAX = 1_000;
export const SUPPORT_REVISIONS_PER_FAMILY_MAX = 200;

export const SUPPORT_FAMILY_KINDS = ["case", "teach", "correction"] as const;
export type SupportFamilyKind = (typeof SUPPORT_FAMILY_KINDS)[number];

/** One independent origin behind an inference, with the evidence revisions it contributed. */
export interface SupportFamily {
  originKey: string;
  kind: SupportFamilyKind;
  /** The photographs (`memory_revisions` ids) of the observations of this family, sorted. */
  revisionIds: string[];
  /** The project identity every observation of the family shares, when they share one. */
  projectId?: string;
  /** The newest `at` of the family, ISO 8601. */
  at: string;
}

export interface SupportCounts {
  families: number;
  observations: number;
  projects: number;
  days: number;
}

/**
 * The independence behind an inference. `refs` are the ids of the observations counted (the
 * `observationId` of the belief's citations that were found with a known origin), sorted.
 */
export interface SupportEvidence {
  schemaVersion: 1;
  supportPolicyVersion: number;
  families: SupportFamily[];
  counts: SupportCounts;
  refs: string[];
}

/** The outcome of a compare-and-set write on a criterion: the revision it left, or why it refused. */
export type BeliefWrite = { revision: number } | { conflict: true; reason: "stale_revision" | "not_found" };

/** A shape error a route can hand back as `invalid_input`; the message names the field. */
export class InvalidTwinInput extends TypeError {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "InvalidTwinInput";
  }
}

const CONTROL = /\p{Cc}/u;
const OPAQUE = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A predicate column as a writer stores it: `undefined` and `null` are "none declared" and
 * become null; anything else goes through core's validator and is stored as the validated tree,
 * never as the input. A shape error is core's `MemoryShapeError`, a `TypeError`.
 */
export function beliefPredicate(value: unknown): Predicate | null {
  if (value === undefined || value === null) return null;
  return validatePredicate(value);
}

/**
 * A stored predicate read back from jsonb. Absence means none declared; a malformed non-null
 * value fails closed, since discarding it would silently widen a conditional instruction.
 */
export function storedPredicate(value: unknown): Predicate | null {
  if (value === null || value === undefined) return null;
  return validatePredicate(value);
}

/**
 * The origin key of an observation as a writer stores it. Absent stays null (a legacy row or a
 * writer that does not know), a string is trimmed, bounded and free of control characters. It
 * does not decide whether the key counts: `originCounts` does, and `unknown` and `copied:`
 * keys are stored exactly as the reader found them.
 */
export function validateCaseOriginKey(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidTwinInput("caseOriginKey", "A case origin key is a string.");
  const key = value.trim();
  if (key.length === 0) throw new InvalidTwinInput("caseOriginKey", "A case origin key is not empty.");
  if (key.length > CASE_ORIGIN_KEY_MAX) throw new InvalidTwinInput("caseOriginKey", `A case origin key has at most ${CASE_ORIGIN_KEY_MAX} characters.`);
  if (CONTROL.test(key)) throw new InvalidTwinInput("caseOriginKey", "A case origin key has no control characters.");
  return key;
}

/**
 * What the distiller reads a turn as (plan §21.3): the seven kinds the column's CHECK admits.
 * The vocabulary lives here, beside the origin key, because the row and the prompt must agree
 * on it and the row is the one that lasts.
 */
export const OBSERVATION_KINDS = ["reaction", "choice", "reason", "condition", "exception", "counterexample", "correction"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** The referent the distiller writes when a reaction names no object: the ambiguous case that never founds a preference. */
export const UNKNOWN_REFERENT = "unknown";
/** A referent is a few words taken from the quote, never a paragraph. */
export const REFERENT_MAX = 120;

export function validateObservationKind(value: unknown): ObservationKind | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !(OBSERVATION_KINDS as readonly string[]).includes(value)) throw new InvalidTwinInput("kind", "An observation kind is one of the seven the distiller writes.");
  return value as ObservationKind;
}

export function validateReferent(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new InvalidTwinInput("referent", "A referent is a string.");
  const referent = value.trim();
  if (referent.length === 0) throw new InvalidTwinInput("referent", "A referent is not empty.");
  if (referent.length > REFERENT_MAX) throw new InvalidTwinInput("referent", `A referent has at most ${REFERENT_MAX} characters.`);
  if (CONTROL.test(referent)) throw new InvalidTwinInput("referent", "A referent has no control characters.");
  return referent;
}

/** The ambiguous reaction of the plan: a reaction whose object nobody could name; evidence that exists and founds nothing. */
export function isAmbiguousReaction(row: { kind: string | null; referent: string | null }): boolean {
  return row.kind === "reaction" && row.referent === UNKNOWN_REFERENT;
}

/** Whether an origin key can found a family: known, and not a copy of somebody else's words. */
export function originCounts(key: string | null | undefined): key is string {
  if (typeof key !== "string" || key.length === 0) return false;
  if (key === UNKNOWN_ORIGIN) return false;
  return !key.startsWith(COPIED_ORIGIN_PREFIX);
}

/** The kind an origin key implies: a lesson is `teach`, everything else a `case`. A correction is the caller's word. */
export function originKind(key: string): SupportFamilyKind {
  return key.startsWith(TEACH_ORIGIN_PREFIX) ? "teach" : "case";
}

function validateIso(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new InvalidTwinInput(field, `${field} is an ISO 8601 instant.`);
  return new Date(value).toISOString();
}

function validateCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new InvalidTwinInput(field, `${field} is a non-negative integer.`);
  return value;
}

function validateFamily(value: unknown, index: number): SupportFamily {
  const field = `families[${index}]`;
  if (!isRecord(value)) throw new InvalidTwinInput(field, "A support family is an object.");
  for (const key of Object.keys(value)) {
    if (!["originKey", "kind", "revisionIds", "projectId", "at"].includes(key)) throw new InvalidTwinInput(field, `A support family has an unknown key: ${key}.`);
  }
  const originKey = validateCaseOriginKey(value["originKey"]);
  if (originKey === null || !originCounts(originKey)) throw new InvalidTwinInput(field, "A support family has a known origin key.");
  const kind = value["kind"];
  if (typeof kind !== "string" || !(SUPPORT_FAMILY_KINDS as readonly string[]).includes(kind)) throw new InvalidTwinInput(field, "A support family is a case, a teach or a correction.");
  const revisionIds = value["revisionIds"];
  if (!Array.isArray(revisionIds) || revisionIds.length > SUPPORT_REVISIONS_PER_FAMILY_MAX) throw new InvalidTwinInput(field, `A support family lists at most ${SUPPORT_REVISIONS_PER_FAMILY_MAX} revisions.`);
  for (const id of revisionIds) {
    if (typeof id !== "string" || !OPAQUE.test(id)) throw new InvalidTwinInput(field, "A support family cites revisions by their opaque id.");
  }
  const family: SupportFamily = {
    originKey,
    kind: kind as SupportFamilyKind,
    revisionIds: [...new Set(revisionIds as string[])].sort(),
    at: validateIso(value["at"], `${field}.at`),
  };
  if (value["projectId"] !== undefined) {
    const projectId = value["projectId"];
    if (typeof projectId !== "string" || projectId.length === 0 || projectId.length > 256 || CONTROL.test(projectId)) {
      throw new InvalidTwinInput(field, "A support family names its project by a bounded identity.");
    }
    family.projectId = projectId;
  }
  return family;
}

/**
 * The stored evidence object, checked whole and returned as a fresh value that carries only
 * validated keys. It checks the shape and the bounds, not the truth: whether the families are
 * really independent is what `supportOf` recomputes from the observations, and a route never
 * takes this object from a model.
 */
export function validateSupportEvidence(input: unknown): SupportEvidence {
  if (!isRecord(input)) throw new InvalidTwinInput("supportEvidence", "The support evidence is an object.");
  for (const key of Object.keys(input)) {
    if (!["schemaVersion", "supportPolicyVersion", "families", "counts", "refs"].includes(key)) {
      throw new InvalidTwinInput("supportEvidence", `The support evidence has an unknown key: ${key}.`);
    }
  }
  if (input["schemaVersion"] !== 1) throw new InvalidTwinInput("supportEvidence", "The support evidence has schemaVersion 1.");
  const policy = input["supportPolicyVersion"];
  if (typeof policy !== "number" || !Number.isSafeInteger(policy) || policy < 1) throw new InvalidTwinInput("supportEvidence", "The support policy version is a positive integer.");
  const families = input["families"];
  if (!Array.isArray(families) || families.length > SUPPORT_FAMILIES_MAX) throw new InvalidTwinInput("supportEvidence", `The support evidence lists at most ${SUPPORT_FAMILIES_MAX} families.`);
  const validatedFamilies = families.map(validateFamily);
  const keys = new Set(validatedFamilies.map((family) => family.originKey));
  if (keys.size !== validatedFamilies.length) throw new InvalidTwinInput("supportEvidence", "Two families share one origin key.");
  const counts = input["counts"];
  if (!isRecord(counts)) throw new InvalidTwinInput("supportEvidence", "The support counts are an object.");
  for (const key of Object.keys(counts)) {
    if (!["families", "observations", "projects", "days"].includes(key)) throw new InvalidTwinInput("supportEvidence", `The support counts have an unknown key: ${key}.`);
  }
  const refs = input["refs"];
  if (!Array.isArray(refs) || refs.length > SUPPORT_REFS_MAX) throw new InvalidTwinInput("supportEvidence", `The support evidence cites at most ${SUPPORT_REFS_MAX} observations.`);
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.length === 0 || ref.length > 128 || CONTROL.test(ref)) throw new InvalidTwinInput("supportEvidence", "A support reference is a bounded observation id.");
  }
  return {
    schemaVersion: 1,
    supportPolicyVersion: policy,
    families: validatedFamilies.sort((a, b) => (a.originKey < b.originKey ? -1 : a.originKey > b.originKey ? 1 : 0)),
    counts: {
      families: validateCount(counts["families"], "counts.families"),
      observations: validateCount(counts["observations"], "counts.observations"),
      projects: validateCount(counts["projects"], "counts.projects"),
      days: validateCount(counts["days"], "counts.days"),
    },
    refs: [...new Set(refs as string[])].sort(),
  };
}

/** The evidence column as a writer stores it: absent or null is a legacy row, anything else is validated. */
export function beliefSupportEvidence(value: unknown): SupportEvidence | null {
  if (value === undefined || value === null) return null;
  return validateSupportEvidence(value);
}

/** The evidence column read back from jsonb: the writer validated it, a malformed value reads as legacy. */
export function storedSupportEvidence(value: unknown): SupportEvidence | null {
  if (!isRecord(value) || value["schemaVersion"] !== 1) return null;
  if (!Array.isArray(value["families"]) || !isRecord(value["counts"]) || !Array.isArray(value["refs"])) return null;
  return value as unknown as SupportEvidence;
}
