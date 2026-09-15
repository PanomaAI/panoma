import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./client";
import { standsUp, type BeliefCitation, type BeliefSupport } from "./queries";
import * as t from "./schema";
import {
  SUPPORT_FAMILIES_FLOOR, SUPPORT_POLICY_VERSION, isAmbiguousReaction, originCounts, originKind,
  type SupportCounts, type SupportEvidence, type SupportFamily, type SupportFamilyKind,
} from "./twin";

/*
  The independence behind an inference (delivery D, plan §10.2, §22.10).

  The legacy floor counts observations, projects and days, and none of the three proves that the
  person said a thing more than once: the same session copied into two windows is two
  observations, two days and one case. Delivery D counts cases instead. Every observation names
  the origin of its quotes —a stream turn, a teach gesture— and two observations with one origin
  key are one family; a copy, a relay, a compaction summary or the system's own output carries
  `copied:` and founds nothing; an origin nobody could establish is `unknown` and founds nothing
  either. A new or revised inference publishes automatically only with three families of known
  origin besides the floor the row already guards; an explicit correction may propose with less,
  never publish nor sign.

  Everything here is arithmetic over rows: `familiesOf` is pure, `supportOf` reads the belief's
  citations and the observations they name and hands the arithmetic what it found, and no model
  is asked what supports what. The object it produces is the one `beliefs.support_evidence`
  stores and the photograph carries; `publishableByPolicy` is the gate that reads it. A legacy
  inference has no object and keeps the floor alone: its eligibility does not change with the
  policy, and no fictitious family is rebuilt to fit an old counter to the new rule.
 */

/** What the arithmetic needs of an observation. `kind` is the caller's word for a correction. */
export interface SupportObservation {
  id?: string;
  caseOriginKey: string | null;
  at: Date | string;
  /** The project identity the observation is about; null or omitted for the whole portfolio. */
  projectId?: string | null;
  /** The observation's photograph, when the caller knows it. */
  revisionId?: string | null;
  kind?: SupportFamilyKind;
}

/** Observations whose origin can found a family: known, and not copied. */
function counted(observations: SupportObservation[]): (SupportObservation & { caseOriginKey: string })[] {
  return observations.filter((one): one is SupportObservation & { caseOriginKey: string } => originCounts(one.caseOriginKey));
}

function instantOf(at: Date | string): number {
  const instant = at instanceof Date ? at.getTime() : Date.parse(at);
  return Number.isNaN(instant) ? 0 : instant;
}

/** The UTC day of an instant, which is how the legacy floor counts days too. */
function dayOf(at: Date | string): string {
  return new Date(instantOf(at)).toISOString().slice(0, 10);
}

/**
 * The families behind a set of observations, by origin key and sorted by it. A `copied:` key,
 * a null key and `unknown` never count. A family's kind is `teach` for a lesson, `correction`
 * when any of its observations says so, `case` otherwise; its `projectId` is the identity every
 * one of its observations shares, and its `at` the newest instant among them.
 */
export function familiesOf(observations: SupportObservation[]): SupportFamily[] {
  const byOrigin = new Map<string, (SupportObservation & { caseOriginKey: string })[]>();
  for (const one of counted(observations)) {
    const family = byOrigin.get(one.caseOriginKey) ?? [];
    family.push(one);
    byOrigin.set(one.caseOriginKey, family);
  }
  const families: SupportFamily[] = [];
  for (const [originKey, members] of byOrigin) {
    const kind: SupportFamilyKind = members.some((one) => one.kind === "correction") ? "correction" : originKind(originKey);
    const projects = new Set(members.map((one) => one.projectId ?? null));
    const newest = Math.max(...members.map((one) => instantOf(one.at)));
    const family: SupportFamily = {
      originKey,
      kind,
      revisionIds: [...new Set(members.map((one) => one.revisionId).filter((id): id is string => typeof id === "string" && id.length > 0))].sort(),
      at: new Date(newest).toISOString(),
    };
    const [only] = projects;
    if (projects.size === 1 && typeof only === "string") family.projectId = only;
    families.push(family);
  }
  return families.sort((a, b) => (a.originKey < b.originKey ? -1 : a.originKey > b.originKey ? 1 : 0));
}

/** The counts over the observations that found a family: what `unknown` and `copied:` never add to. */
export function supportCountsOf(observations: SupportObservation[]): SupportCounts {
  const admissible = counted(observations);
  return {
    families: new Set(admissible.map((one) => one.caseOriginKey)).size,
    observations: admissible.length,
    projects: new Set(admissible.map((one) => one.projectId).filter((id): id is string => typeof id === "string" && id.length > 0)).size,
    days: new Set(admissible.map((one) => dayOf(one.at))).size,
  };
}

/** The evidence object of a set of observations, pure: what `supportOf` stores once it has read them. */
export function supportEvidenceOf(observations: SupportObservation[]): SupportEvidence {
  return {
    schemaVersion: 1,
    supportPolicyVersion: SUPPORT_POLICY_VERSION,
    families: familiesOf(observations),
    counts: supportCountsOf(observations),
    refs: [...new Set(counted(observations).map((one) => one.id).filter((id): id is string => typeof id === "string" && id.length > 0))].sort(),
  };
}

/** PostgreSQL's extended protocol allows 65,535 parameters; the ids travel in pages. */
const READ_CHUNK = 500;

/**
 * The independence behind one belief, recomputed from the catalog and never from a model: the
 * observations its citations name, read with their origin keys and their newest photographs.
 * A citation whose observation no longer exists —forgotten, purged— adds nothing, which is how
 * withdrawing evidence lowers the support (§22.10). Undefined for a belief that is not there.
 *
 * The citations are what the belief kept, trimmed to the most recent (see `beliefs.citations`
 * in `schema.ts`): what this counts is the evidence the belief can still show, not every row
 * that ever touched its topic.
 */
export async function supportOf(db: Database, beliefId: string): Promise<SupportEvidence | undefined> {
  const [belief] = await db.select({ citations: t.beliefs.citations }).from(t.beliefs).where(eq(t.beliefs.id, beliefId)).limit(1);
  if (!belief) return undefined;
  const citations = Array.isArray(belief.citations) ? (belief.citations as Partial<BeliefCitation>[]) : [];
  const ids = [...new Set(citations.map((one) => one.observationId).filter((id): id is string => typeof id === "string" && id.length > 0))];
  const observations: SupportObservation[] = [];
  for (let offset = 0; offset < ids.length; offset += READ_CHUNK) {
    const page = ids.slice(offset, offset + READ_CHUNK);
    const rows = await db
      .select({ id: t.observations.id, identity: t.observations.identity, at: t.observations.at, caseOriginKey: t.observations.caseOriginKey, kind: t.observations.kind, referent: t.observations.referent })
      .from(t.observations)
      .where(inArray(t.observations.id, page));
    const photographs = await db
      .select({ objectId: t.memoryRevisions.objectId, id: t.memoryRevisions.id, rev: t.memoryRevisions.rev })
      .from(t.memoryRevisions)
      .where(and(eq(t.memoryRevisions.kind, "observation"), inArray(t.memoryRevisions.objectId, page)));
    const newest = new Map<string, { id: string; rev: number }>();
    for (const one of photographs) {
      const seen = newest.get(one.objectId);
      if (!seen || one.rev > seen.rev) newest.set(one.objectId, { id: one.id, rev: one.rev });
    }
    for (const row of rows) {
      // An ambiguous reaction founds nothing (plan §21.3); a stored correction names its family's kind itself.
      if (isAmbiguousReaction(row)) continue;
      observations.push({
        id: row.id,
        caseOriginKey: row.caseOriginKey,
        at: row.at,
        projectId: row.identity,
        revisionId: newest.get(row.id)?.id ?? null,
        ...(row.kind === "correction" ? { kind: "correction" as const } : {}),
      });
    }
  }
  return supportEvidenceOf(observations);
}

/**
 * Whether an inference may publish automatically: the legacy floor (`standsUp`: three
 * observations and two days or two projects) and, since delivery D, three families of known
 * origin. A legacy row —no evidence object— keeps the floor alone, so migrating the policy
 * despublishes nothing the person already reads (§10.2). It answers a policy, not an authority:
 * a signature publishes without asking this, and a correction proposes without passing it.
 */
export function publishableByPolicy(support: BeliefSupport, supportEvidence: SupportEvidence | null | undefined): boolean {
  if (!standsUp(support)) return false;
  if (!supportEvidence) return true;
  return supportEvidence.counts.families >= SUPPORT_FAMILIES_FLOOR;
}
