import { redactSecrets } from "@panoma/core";
import { listDecisionEpisodes, type Database, type DecisionEpisode } from "@panoma/db";

/*
  The wire from decision memory to the agent.

  An episode keeps the situation a choice made sense in — the decision, why, when it applies and
  when it does not. That is exactly what the next agent in the project needs before touching it,
  and until 5-Sep-2026 nothing an episode held reached any agent: the layer fed only the owner's
  Lab. This is the one wire, and it is deliberately narrow:

  - **Owner-authored only.** The grounding checks on extracted episodes prove that the bytes are
    the owner's, not that the model put them in the right role: a `decision` field could be a goal
    the model misfiled. What an agent acts on has to be what the owner wrote as a decision, in the
    form that takes no model. Extracted episodes stay in the Lab until the owner revises them,
    which makes them owner-authored.
  - **No model call, ever.** It is a read of the catalog served in the briefing, like the notes.
  - **Bounded.** Six decisions, brief previews, fifteen hundred characters in all.
    Conditions and exceptions are never cut into apparently complete rules. An incomplete
    preview directs the reader to the full record before applying the decision.
    The briefing is read on every visit, and a briefing that grows with the corpus is a briefing
    that stops being read.
 */

export const BRIEF_DECISIONS = 6;
export const BRIEF_FIELD_CHARS = 240;
export const BRIEF_CHARS = 1_500;

export interface BriefDecision {
  id: string;
  decision: string;
  rationale?: string;
  conditions?: string;
  exceptions?: string;
  /** Recorded for this project, or for every project the owner works in. */
  scope: "project" | "general";
  recordedAt: string;
  /** Full owner-readable record, even when it is outside the recent memory view. */
  source: string;
  /** A preview only: read the complete record before applying it. */
  incomplete?: true;
}

/**
 * The owner's active decisions for a project: the ones scoped to it first, then the general ones,
 * newest first within each. Only episodes with a decision travel — a goal alone tells an agent
 * what someone wanted, not what to do about it.
 */
export async function ownerDecisionsFor(database: Database, identity: string | null): Promise<BriefDecision[]> {
  // One instant for both reads, and it is read before the candidate limits: a decision whose day
  // has passed is not a decision the agent has to weigh, it is context that costs and misleads.
  const now = new Date();
  const rows = (await Promise.all([
    identity === null ? [] : listDecisionEpisodes(database, { identity, status: "active", ownerDecisionsOnly: true, unambiguousOnly: true, activeAt: now, limit: 50 }),
    listDecisionEpisodes(database, { identity: null, status: "active", ownerDecisionsOnly: true, unambiguousOnly: true, activeAt: now, limit: 50 }),
  ])).flat();
  const brief: BriefDecision[] = [];
  let used = 0;
  for (const row of rows) {
    const item = briefOf(row);
    if (!item) continue;
    const size = JSON.stringify(item).length;
    if (brief.length >= BRIEF_DECISIONS) break;
    if (used + size > BRIEF_CHARS) continue;
    brief.push(item);
    used += size;
  }
  return brief;
}

/**
 * The preview of one episode, or nothing when it cannot travel: not the owner's, or no decision.
 * Exported so the task-aware delivery shapes its decisions exactly like the recency brief does —
 * same shortening, same incomplete flag, same source link — instead of a second, drifting copy.
 */
export function briefOf(row: DecisionEpisode): BriefDecision | undefined {
  if (row.origin !== "owner") return undefined;
  const decision = row.fields.decision?.text.trim();
  if (!decision) return undefined;
  let incomplete = redactSecrets(decision).length > BRIEF_FIELD_CHARS;
  const field = (name: "rationale" | "conditions" | "exceptions") => {
    const text = redactSecrets(row.fields[name]?.text.trim() ?? "");
    if (!text) return {};
    if (text.length > BRIEF_FIELD_CHARS) {
      incomplete = true;
      if (name !== "rationale") return {};
    }
    return { [name]: shorten(text) };
  };
  return {
    id: row.id,
    decision: shorten(redactSecrets(decision)),
    ...field("rationale"),
    ...field("conditions"),
    ...field("exceptions"),
    scope: row.identity === null ? "general" : "project",
    recordedAt: row.createdAt.toISOString().slice(0, 10),
    source: `/twin?episode=${encodeURIComponent(row.id)}#episode-${row.id}`,
    ...(incomplete ? { incomplete: true as const } : {}),
  };
}

function shorten(text: string): string {
  return text.length > BRIEF_FIELD_CHARS ? `${text.slice(0, BRIEF_FIELD_CHARS - 1).trimEnd()}…` : text;
}
