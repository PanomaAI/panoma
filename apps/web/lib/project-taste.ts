import { topicsOf, type TasteLine } from "@panoma/core";

/*
  The portrait of a project: which of your phrases rule in here.
  It was missing, and it was the strangest gap of all Twin. The annotation can be attached to a
  project —"this only applies in Travocato"—, the annotation travels to the file, the file goes
  down through `AGENTS.md`, and the agent working in Travocato reads it. All that worked, and from
  the project record you couldn't see anything: neither which phrases apply to it, nor that there
  are three attached to it, nor that a screen exists to correct them. The only way to know what
  your agent reads when entering here was to open `TASTE.md` and filter manually.
  ── It is read from the file, not from the database ─────────────────────────────────────────────
  It is the same decision that the critic's path makes and for the same reason: `TASTE.md` is
  exactly what arrives through `AGENTS.md`, so exposing database beliefs would expose
  something that may not be written yet —or that the person erased by hand a minute ago—. What
  this screen promises is 'this is what your agents read here,' and only the file knows that.
  And the filter is `tasteDigest`, line by line: the global always, and from the limited only what
  is from this project. If the two diverge, the screen promises one thing and the channel delivers
  another — which is the failure that has already cost an increase with the budget card.
 */

/** A sentence from the portrait as seen within a project. */
export interface ProjectLine {
  statement: string;
  /**
   * Yes, it is **only** valid here. The global one is not marked: that's normal, and marking it
   * would be noise.
   */
  only: boolean;
}

/** The phrases of a subject that govern in this project. */
export interface ProjectTopic {
  topic: string;
  lines: ProjectLine[];
}

/**
 * The portrait seen from a project, grouped by subject and in the order in which it is written.
 *
 * `topicsOf` comes from `@panoma/core` and is not copied here: it is the same order in which the
 * file is written and with which the summary read by the agents is assembled, and with an open
 * vocabulary —where a subject can appear on a Tuesday— two orderings for the same thing diverge as
 * soon as someone coins one.
 *
 * `project` is the **name** of the project, which is how the scope travels in the file:
 * `only in dricopilot:`. Without a name there is nothing to filter and the entire portrait comes
 * out, which is correct — a project without a name cannot have its own sentences.
 */
export function tasteForProject(lines: TasteLine[], project: string): ProjectTopic[] {
  const out: ProjectTopic[] = [];

  for (const topic of topicsOf(lines)) {
    const suyas: ProjectLine[] = [];
    for (const line of lines) {
      if (line.topic !== topic) continue;
      // The same filter as `digest`: the global always, the limited only if it is from here.
      if (line.scope !== undefined && line.scope !== project) continue;
      const statement = line.statement.replace(/\s+/g, " ").trim();
      if (statement === "") continue;
      suyas.push({ statement, only: line.scope !== undefined });
    }
    if (suyas.length > 0) out.push({ topic, lines: suyas });
  }

  return out;
}

/** How many sentences rule here, and how many of them are only from here. */
export function countProjectTaste(topics: ProjectTopic[]): { total: number; only: number } {
  let total = 0;
  let only = 0;
  for (const one of topics) {
    for (const line of one.lines) {
      total += 1;
      if (line.only) only += 1;
    }
  }
  return { total, only };
}
