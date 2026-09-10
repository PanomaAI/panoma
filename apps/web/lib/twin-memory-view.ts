import type { MessageKey } from "./i18n";

/** Client-safe decision memory contracts. Coverage describes recorded evidence, not certainty. */
export const MEMORY_FIELDS = [
  "goal", "context", "constraints", "alternatives", "decision", "rationale", "outcome",
  "conditions", "exceptions",
] as const;

export type MemoryField = typeof MEMORY_FIELDS[number];

export interface EpisodeView {
  id: string;
  identity: string | null;
  projectName: string | null;
  origin: "owner" | "history";
  status: "active" | "dismissed";
  /**
   * The last day the decision applies, kept as the instant that day ends: an ISO instant, or null
   * when the record never expires. The owner writes a plain calendar day and the store closes it
   * at 23:59:59.999 UTC, so the day is read back out of this string in UTC and never in the
   * reader's zone — east of Greenwich a local reading lands on the day after the one written.
   */
  validUntil: string | null;
  supersedesId?: string | null;
  /** Computed from the complete revision family on the server, not from this recent page. */
  activeRevisionId?: string | null;
  fields: Partial<Record<MemoryField, { text: string; narrativeId?: string }>>;
  createdAt: string;
  updatedAt?: string;
}

/**
 * What each dimension is called on screen, as dictionary keys and not as sentences. The section
 * shipped on 5-Sep-2026 with the copy written here in English, so whoever read the browser in
 * Spanish got one monolingual box on a bilingual page. The words live in `lib/i18n.ts` and are
 * resolved where they are rendered, with the reader's language in hand.
 */
export const FIELD_KEYS: Record<MemoryField, { label: MessageKey; hint: MessageKey }> = {
  goal: { label: "twinMemory.fieldGoal", hint: "twinMemory.hintGoal" },
  context: { label: "twinMemory.fieldContext", hint: "twinMemory.hintContext" },
  constraints: { label: "twinMemory.fieldConstraints", hint: "twinMemory.hintConstraints" },
  alternatives: { label: "twinMemory.fieldAlternatives", hint: "twinMemory.hintAlternatives" },
  decision: { label: "twinMemory.fieldDecision", hint: "twinMemory.hintDecision" },
  rationale: { label: "twinMemory.fieldRationale", hint: "twinMemory.hintRationale" },
  outcome: { label: "twinMemory.fieldOutcome", hint: "twinMemory.hintOutcome" },
  conditions: { label: "twinMemory.fieldConditions", hint: "twinMemory.hintConditions" },
  exceptions: { label: "twinMemory.fieldExceptions", hint: "twinMemory.hintExceptions" },
};

/**
 * The throughput of one extraction pass, for the screen to say how long a queue takes. They
 * mirror `BATCH_SIZE` and `MAX_BATCHES` in `lib/episode-learning.ts`, which imports the database
 * and cannot reach a client component; `docs/decision-memory.md` records both figures.
 */
export const RECORDS_PER_CALL = 12;
export const CALLS_PER_PASS = 2;

/**
 * How many records one page of the archive carries. The owner screen seeds the first page and
 * `GET /api/twin/episodes` serves the next ones from a cursor; both count with this figure, and
 * `twinMemory.shown` says it to the person.
 */
export const EPISODE_PAGE = 100;

/** The longest search the archive answers; the input stops there and the route refuses past it. */
export const EPISODE_QUERY_MAX = 200;

export function episodeCoverage(episode: Pick<EpisodeView, "fields">) {
  const recorded = MEMORY_FIELDS.filter((field) => Boolean(episode.fields[field]?.text.trim()));
  return {
    recorded,
    missing: MEMORY_FIELDS.filter((field) => !recorded.includes(field)),
  };
}

/** The first field worth a headline, or null so the caller supplies a translated fallback. */
export function episodeTitle(episode: Pick<EpisodeView, "fields">): string | null {
  return episode.fields.decision?.text.trim() || episode.fields.goal?.text.trim()
    || episode.fields.context?.text.trim() || null;
}

/**
 * Whether the last day the decision applies has already gone by. An instant that has passed stops
 * the record reaching any agent, which is the whole point of writing a date on it: an expired
 * decision costs an agent's context and gives it nothing back.
 *
 * `now` is a parameter so a test can stand anywhere in time rather than around today. A date that
 * cannot be read at all —a string that is not an instant— counts as no expiry: the record keeps
 * being delivered, which is what it did before anyone wrote a date on it.
 */
export function episodeExpired(episode: Pick<EpisodeView, "validUntil">, now: number = Date.now()): boolean {
  return episode.validUntil !== null && Date.parse(episode.validUntil) <= now;
}

/**
 * Where an episode can reach, said as eligibility and not as delivery. The briefing an agent
 * receives is capped afterwards — six decisions, 1,500 characters, the project's own first — so
 * an eligible record can still be cut from one briefing; the card says which doors are open to it,
 * and the cap is the briefing's business. The rules mirror the filters in `lib/decision-brief.ts`
 * and `lib/consult.ts`: owner authorship and a written decision for the briefing, an active status
 * for either, and no second active version anywhere in the family for both.
 *
 * Expiry is asked before the competing case, and not after it, because the two answers are not
 * equally true. A withheld record reaches nobody *until one version is kept*, and that sentence
 * offers a way out; an expired one is not delivered whichever version wins, so keeping one would
 * be a promise the date breaks. The way out of an expired record is clearing the date, and that is
 * what its own sentence says.
 */
export function episodeReach(
  episode: Pick<EpisodeView, "identity" | "origin" | "status" | "fields" | "validUntil">,
  competing: boolean,
): MessageKey {
  if (episode.status === "dismissed") return "twinMemory.reachNowhere";
  if (episodeExpired(episode)) return "twinMemory.reachExpired";
  if (competing) return "twinMemory.reachWithheld";
  if (episode.origin === "history") return "twinMemory.reachLabOnly";
  if (!episode.fields.decision?.text.trim()) return "twinMemory.reachNoDecision";
  return episode.identity ? "twinMemory.reachProject" : "twinMemory.reachGeneral";
}

/**
 * The paging position, as the screen carries it: opaque to the component, written by the server
 * that hands out the first page and read back by the route that serves the next. It lives in this
 * client-safe file because both ends import it and neither needs more than `btoa`; the position is
 * plain ASCII —an ISO instant and a hexadecimal identifier— so the base64 conversion has nothing to
 * escape. Parsing is strict: a cursor is the one string this route accepts from the address bar
 * without the dictionary of a form behind it, and anything that is not exactly a position is
 * refused rather than guessed.
 */
const CURSOR_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function episodeCursor(position: { createdAt: string; id: string }): string {
  return btoa(JSON.stringify({ createdAt: position.createdAt, id: position.id }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseEpisodeCursor(cursor: string): { createdAt: Date; id: string } | undefined {
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/").padEnd(cursor.length + (4 - cursor.length % 4) % 4, "=");
    const saved = JSON.parse(atob(padded)) as unknown;
    if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return undefined;
    const { createdAt, id } = saved as Record<string, unknown>;
    if (typeof createdAt !== "string" || !CURSOR_AT.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) return undefined;
    if (typeof id !== "string" || !CURSOR_ID.test(id)) return undefined;
    return { createdAt: new Date(createdAt), id };
  } catch {
    return undefined;
  }
}
