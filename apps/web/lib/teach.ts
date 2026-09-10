import { redactSecrets } from "@panoma/core";
import { ALIVE, insertBeliefs, listBeliefs, resolveProject, signBelief, type Database } from "@panoma/db";
import { TEACH_MAX } from "./twin-limits";

/*
  A direct instruction is a signature, not invented historical evidence. The number itself lives in
  `twin-limits.ts`, which imports nothing: the form that counts up to it runs in the browser, and
  this file reaches `@panoma/db`.
 */
export { TEACH_MAX } from "./twin-limits";

export interface Teaching {
  statement: string;
  topic: string;
  slug?: string;
}

export class TeachingError extends Error {
  constructor(readonly reason: "invalid" | "project" | "scope") {
    super(reason);
  }
}

export function parseTeaching(value: unknown): Teaching {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TeachingError("invalid");
  }
  const row = value as Record<string, unknown>;
  if (typeof row["statement"] !== "string" || typeof row["topic"] !== "string") {
    throw new TeachingError("invalid");
  }
  const statement = redactSecrets(row["statement"].normalize("NFC").replace(/\s+/g, " ").trim());
  const topic = row["topic"].trim();
  if (!statement || statement.length > TEACH_MAX || !/^[a-z][a-z0-9-]{0,23}$/.test(topic)) {
    throw new TeachingError("invalid");
  }
  if (row["slug"] !== undefined && (typeof row["slug"] !== "string" || !row["slug"].trim())) {
    throw new TeachingError("invalid");
  }
  return { statement, topic, ...(typeof row["slug"] === "string" ? { slug: row["slug"].trim() } : {}) };
}

/**
 * Whether a rule may be narrowed to this project — the one rule, so the picker and the server
 * cannot disagree about it.
 *
 * `TASTE.md` writes a scope as the project's NAME, not as its identity, so a name that is missing,
 * unrepresentable in that file, or shared with another project cannot carry one: on a disk with
 * twenty folders called `kiosk_new`, «only in kiosk_new» names all twenty, and the agents
 * reading the file would apply the rule in nineteen places it was never meant for.
 *
 * It lived only inside `teachBelief` and the screen did not ask it, so `/twin` offered every
 * project in the catalog and each of those twenty options failed after the press with
 * `twinTeach.scopeError` — a rule explained at the one moment it can no longer be acted on. The
 * predicate is exported so the list can be built from the same sentence that judges it.
 */
export function scopable(identity: string | null, names: Record<string, string>): boolean {
  if (!identity) return false;
  const name = names[identity];
  if (!name || name.length > 60 || /[:\n\r]|<!--|-->/.test(name) || name.trim() !== name) return false;
  return Object.values(names).filter((other) => other === name).length === 1;
}

/** Called inside the same transaction as portrait publication; retries do not add copies. */
export async function teachBelief(
  database: Database,
  input: Teaching,
  names: Record<string, string>,
): Promise<{ id: string; created: boolean }> {
  let identity: string | null = null;
  if (input.slug) {
    const project = await resolveProject(database, { slug: input.slug });
    if (!project) throw new TeachingError("project");
    identity = project.identity;
    // TASTE.md scopes use names. Missing or ambiguous names must never become a global rule.
    if (!scopable(identity, names)) throw new TeachingError("scope");
  }
  const key = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  const duplicate = (await listBeliefs(database, { states: ALIVE })).find((belief) =>
    belief.topic === input.topic && belief.identity === identity && key(belief.statement) === key(input.statement),
  );
  if (duplicate) {
    await signBelief(database, duplicate.id);
    return { id: duplicate.id, created: false };
  }
  const [id] = await insertBeliefs(database, [{
    topic: input.topic,
    statement: input.statement,
    identity,
    state: "signed",
    citations: [],
    support: { observations: 0, projects: 0, days: 0 },
    // Empty model means a correction to machine prose in the scoreboard. This is authorship.
    model: "owner",
  }]);
  await signBelief(database, id!);
  return { id: id!, created: true };
}
