import type { Narrative } from "@panoma/core";
import type { NewNarrative } from "@panoma/db";
import { identityOf } from "./verdicts";

/** Keep narrative evidence scoped with the same path attribution used by legacy reactions. */
export function toNarratives(rows: Narrative[], identities: ReadonlyMap<string, string>) {
  const narratives: NewNarrative[] = [];
  let unmatched = 0;
  let undated = 0;
  for (const row of rows) {
    const at = new Date(row.at);
    if (!Number.isFinite(at.getTime())) { undated += 1; continue; }
    const identity = identityOf({ ...row, reaction: row.text, signals: [] }, identities);
    if (!identity) { unmatched += 1; continue; }
    narratives.push({ identity, source: row.source, sessionId: row.sessionId, at, kind: row.kind,
      text: row.text, context: row.context, truncated: row.truncated });
  }
  return { narratives, unmatched, undated };
}
